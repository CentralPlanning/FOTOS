import os
import socket
from flask import Flask, jsonify, request, send_from_directory, abort, render_template_string
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

# === 🔒 RESTRIÇÃO POR DOMÍNIO DNS OU IP INTERNO ===
@app.before_request
def restrict_domain():
    try:
        client_ip = request.remote_addr
        hostname = socket.getfqdn(client_ip) or ""
        print(f"🌐 Acesso de {client_ip} ({hostname})")

        # Permitir apenas admcuiba.com ou IP interno 10.167.*
        if "admcuiba.com" not in hostname and not client_ip.startswith("10.167."):
            print(f"🚫 Acesso negado: {client_ip} ({hostname})")
            abort(403)
    except Exception as e:
        print(f"⚠️ Erro ao verificar domínio: {e}")
        abort(403)

# === PÁGINA PERSONALIZADA DE BLOQUEIO 403 ===
@app.errorhandler(403)
def forbidden_page(e):
    html = """
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Acesso Restrito</title>
        <style>
            body {
                background-color: #f4f4f4;
                font-family: 'Segoe UI', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
            }
            .card {
                background: white;
                padding: 40px 60px;
                border-radius: 16px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 480px;
            }
            img {
                width: 110px;
                margin-bottom: 20px;
            }
            h1 {
                color: #222;
                font-size: 22px;
                margin-bottom: 12px;
            }
            p {
                color: #555;
                font-size: 15px;
                line-height: 1.6;
            }
            .highlight {
                color: #d4a200;
                font-weight: 600;
            }
            .footer {
                margin-top: 25px;
                font-size: 13px;
                color: #999;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="https://centralplanning.github.io/FOTOS_DATA/logo-dark.png" alt="Central Planning">
            <h1>🔒 Acesso restrito à rede corporativa</h1>
            <p>Este sistema só pode ser acessado a partir de conexões da rede interna <span class="highlight">admcuiba.com</span>.</p>
            <p>Se você acredita que isso é um erro, entre em contato com o suporte técnico.</p>
            <div class="footer">© Central Planning • 2025</div>
        </div>
    </body>
    </html>
    """
    return render_template_string(html), 403

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
    return send_from_directory(".", "index.html")

# === LISTAR ARQUIVOS ===
@app.route("/list_files", methods=["GET"])
def list_files():
    try:
        token = request.args.get("token")
        max_keys = int(request.args.get("max", 1000))
        kwargs = {"Bucket": BUCKET, "Prefix": FOLDER, "MaxKeys": max_keys}
        if token:
            kwargs["ContinuationToken"] = token

        response = s3.list_objects_v2(**kwargs)
        items = [
            {"name": obj["Key"].split("/")[-1], "url": f"{PUBLIC_URL}/{obj['Key']}"}
            for obj in response.get("Contents", [])
            if not obj["Key"].endswith("/")
        ]
        return jsonify({
            "items": items,
            "next_token": response.get("NextContinuationToken"),
            "has_more": bool(response.get("NextContinuationToken"))
        })
    except Exception as e:
        print("❌ Erro ao listar arquivos:", e)
        return jsonify({"error": str(e)}), 500

# === UPLOAD ===
@app.route("/upload", methods=["POST"])
def upload_file():
    try:
        if "file" not in request.files:
            return jsonify({"error": "Nenhum arquivo enviado"}), 400
        file = request.files["file"]
        filename = secure_filename(file.filename)
        destino = f"{FOLDER}{filename}"
        s3.upload_fileobj(file, BUCKET, destino, ExtraArgs={"ContentType": file.content_type})
        return jsonify({"message": "Upload concluído!", "url": f"{PUBLIC_URL}/{destino}"})
    except Exception as e:
        print("❌ Erro no upload:", e)
        return jsonify({"error": str(e)}), 500

# === EXCLUIR ===
@app.route("/delete", methods=["POST"])
def delete_file():
    try:
        data = request.get_json()
        filename = data.get("filename")
        if not filename:
            return jsonify({"error": "Nome do arquivo ausente"}), 400
        s3.delete_object(Bucket=BUCKET, Key=f"{FOLDER}{filename}")
        print(f"🗑️ Arquivo excluído: {filename}")
        return jsonify({"message": f"{filename} removido com sucesso!"})
    except Exception as e:
        print("❌ Erro ao excluir:", e)
        return jsonify({"error": str(e)}), 500

# === INICIAR SERVIDOR ===
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
