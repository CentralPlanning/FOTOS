import os
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS
import boto3
from botocore.client import Config
from werkzeug.utils import secure_filename

# === VARIÁVEIS DE AMBIENTE ===
ACCOUNT_ID = os.getenv("ACCOUNT_ID")
ACCESS_KEY = os.getenv("ACCESS_KEY")
SECRET_KEY = os.getenv("SECRET_KEY")
BUCKET = os.getenv("BUCKET")
PUBLIC_URL = os.getenv("PUBLIC_URL")
FOLDER = "imagens/"
ENDPOINT = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

# === INICIAR FLASK ===
app = Flask(__name__)
CORS(app)

# === 🔒 RESTRIÇÃO DE IP CORPORATIVO ===
@app.before_request
def restrict_ip():
    client_ip = request.remote_addr or ''
    if not client_ip.startswith("10.167."):
        print(f"🚫 Acesso negado para IP: {client_ip}")
        abort(403)  # Acesso proibido

# === CONEXÃO COM CLOUDFLARE R2 ===
s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto"
)

# === ROTA PRINCIPAL (Serve o index.html) ===
@app.route("/")
def serve_index():
    """Serve o index.html do frontend (na raiz do projeto)."""
    return send_from_directory(".", "index.html")


# === LISTAR ARQUIVOS PAGINADO ===
@app.route("/list_files", methods=["GET"])
def list_files():
    try:
        token = request.args.get("token")  # token opcional
        max_keys = int(request.args.get("max", 1000))  # máximo por página

        kwargs = {
            "Bucket": BUCKET,
            "Prefix": FOLDER,
            "MaxKeys": max_keys
        }
        if token:
            kwargs["ContinuationToken"] = token

        response = s3.list_objects_v2(**kwargs)

        items = []
        for obj in response.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/"):
                continue
            items.append({
                "name": key.split("/")[-1],
                "url": f"{PUBLIC_URL}/{key}"
            })

        next_token = response.get("NextContinuationToken")

        return jsonify({
            "items": items,
            "next_token": next_token,
            "has_more": bool(next_token)
        })
    except Exception as e:
        print("❌ Erro ao listar arquivos:", e)
        return jsonify({"error": str(e)}), 500


# === UPLOAD DE ARQUIVOS ===
@app.route("/upload", methods=["POST"])
def upload_file():
    try:
        if "file" not in request.files:
            return jsonify({"error": "Nenhum arquivo enviado"}), 400

        file = request.files["file"]
        filename = secure_filename(file.filename)
        destino = f"{FOLDER}{filename}"

        s3.upload_fileobj(file, BUCKET, destino, ExtraArgs={"ContentType": file.content_type})
        url = f"{PUBLIC_URL}/{destino}"
        print(f"✅ Upload concluído: {url}")

        return jsonify({"message": "Upload concluído!", "url": url})
    except Exception as e:
        print("❌ Erro no upload:", e)
        return jsonify({"error": str(e)}), 500


# === EXCLUIR ARQUIVO ===
@app.route("/delete", methods=["POST"])
def delete_file():
    try:
        data = request.get_json()
        filename = data.get("filename")

        if not filename:
            return jsonify({"error": "Nome do arquivo ausente"}), 400

        key = f"{FOLDER}{filename}"
        s3.delete_object(Bucket=BUCKET, Key=key)
        print(f"🗑️ Arquivo excluído: {key}")

        return jsonify({"message": f"{filename} removido com sucesso!"})
    except Exception as e:
        print("❌ Erro ao excluir:", e)
        return jsonify({"error": str(e)}), 500


# === INICIAR SERVIDOR ===
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
