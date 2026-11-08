#!/usr/bin/env python3
"""Servidor estático local do Protetor de tela.

Diferenças em relação a `python3 -m http.server`:
  - suporta pedidos parciais (Range), necessários para vídeos tocarem, avançarem e repetirem;
  - envia o cabeçalho CORS (Access-Control-Allow-Origin: *), para que temas isolados
    (iframe sandbox) possam ler arquivos da própria pasta com fetch;
  - escuta só em 127.0.0.1 por padrão (nada na rede local enxerga o app).

Uso:
  python3 serve.py              # porta 5180
  python3 serve.py 8080         # outra porta
  python3 serve.py 8080 --host 0.0.0.0   # (opcional) aceita conexões da rede local
"""
import argparse
import os
import re
import shutil
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


class Handler(SimpleHTTPRequestHandler):
    _remaining = None  # bytes que ainda faltam enviar numa resposta parcial

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def send_head(self):
        self._remaining = None
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        path = self.translate_path(self.path)
        match = RANGE_RE.match(rng.strip())
        if os.path.isdir(path) or not match or match.groups() == ("", ""):
            return super().send_head()  # sem Range válido: resposta normal

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "Arquivo não encontrado")
            return None

        stat = os.fstat(f.fileno())
        size = stat.st_size
        first, last = match.groups()
        if first == "":                       # "bytes=-N": os últimos N bytes
            start = max(0, size - int(last))
            end = size - 1
        else:
            start = int(first)
            end = int(last) if last else size - 1
        end = min(end, size - 1)

        if size == 0 or start >= size or start > end:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        f.seek(start)
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        try:
            if self._remaining is None:
                shutil.copyfileobj(source, outputfile)
                return
            left = self._remaining
            while left > 0:
                chunk = source.read(min(64 * 1024, left))
                if not chunk:
                    break
                outputfile.write(chunk)
                left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            # o navegador cancela pedidos de vídeo o tempo todo (ao avançar, ao fechar): normal
            pass

    def log_message(self, fmt, *args):
        if os.environ.get("SERVE_QUIET"):
            return
        super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description="Servidor estático local do Protetor de tela")
    parser.add_argument("port", nargs="?", type=int, default=5180)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    os.chdir(os.path.dirname(os.path.abspath(__file__)))  # serve a pasta deste arquivo
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("Protetor de tela em http://%s:%d  (Ctrl+C para parar)" % (args.host if args.host != "0.0.0.0" else "localhost", args.port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrado.")
        sys.exit(0)


if __name__ == "__main__":
    main()
