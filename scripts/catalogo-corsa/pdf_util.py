# Utilidades de lectura del PDF de Corsa (PyMuPDF). Ejecutar con python -I.
# volcar(pagina) -> dict con titulo, ruta (familia / subfamilia), bloques de texto,
# filas de tabla reconstruidas (filas que empiezan por un codigo Corsa) e imagenes.
import re, sys
import pymupdf as fitz

PDF = r"C:\Users\mario\Downloads\Corsa - Catalogo - Nacional - digital V.01.pdf"
RE_COD = re.compile(r"^[A-Z]{1,2}-\d{5,7}[A-Z]?$")

def abrir(ruta=PDF):
    return fitz.open(ruta)

def _celdas(palabras, hueco=7.5):
    """Agrupa palabras de una linea en celdas por hueco horizontal."""
    palabras = sorted(palabras, key=lambda w: w[0])
    celdas, act, x1 = [], [], None
    for w in palabras:
        if act and w[0] - x1 > hueco:
            celdas.append(act); act = []
        act.append(w); x1 = w[2]
    if act: celdas.append(act)
    return [{"x0": round(c[0][0], 1), "x1": round(c[-1][2], 1), "t": " ".join(x[4] for x in c)} for c in celdas]

def lineas(pagina, tol=2.5):
    """Palabras agrupadas en lineas por su y central."""
    ws = pagina.get_text("words")
    ws.sort(key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    out = []
    for w in ws:
        yc = (w[1] + w[3]) / 2
        if out and abs(out[-1]["y"] - yc) <= tol:
            out[-1]["w"].append(w)
        else:
            out.append({"y": yc, "w": [w]})
    return [{"y": round(l["y"], 1), "celdas": _celdas(l["w"])} for l in out]

def filas_tabla(pagina):
    """Filas cuya primera celda es un codigo Corsa (A-253106...), con su cabecera mas cercana por encima."""
    ls = lineas(pagina)
    filas = []
    for i, l in enumerate(ls):
        if not l["celdas"]: continue
        primera = l["celdas"][0]["t"].split(" ")[0]
        if RE_COD.match(primera):
            cab = None
            for j in range(i - 1, -1, -1):
                if any(c["t"].startswith(("Código", "Codigo", "Cód")) for c in ls[j]["celdas"]):
                    cab = [c["t"] for c in ls[j]["celdas"]]
                    # cabeceras en dos lineas: juntar la siguiente si no es fila
                    if j + 1 < i and not RE_COD.match(ls[j + 1]["celdas"][0]["t"].split(" ")[0]):
                        cab2 = [c["t"] for c in ls[j + 1]["celdas"]]
                        cab = cab + ["//"] + cab2
                    break
            filas.append({"y": l["y"], "celdas": [c["t"] for c in l["celdas"]], "x": [c["x0"] for c in l["celdas"]], "cabecera": cab})
    return filas

def imagenes(doc, pagina):
    out = []
    for im in pagina.get_images(full=True):
        xref, smask = im[0], im[1]
        try:
            rects = pagina.get_image_rects(xref)
        except Exception:
            rects = []
        out.append({"xref": xref, "smask": smask, "w": im[2], "h": im[3], "rects": [[round(v) for v in r] for r in rects]})
    return out

def cajas(pagina, area_min=15000):
    """Rectangulos rellenos grandes (p. ej. el recuadro azul de «Guía de medidas»)."""
    out = []
    for d in pagina.get_drawings():
        r = d.get("rect")
        if d.get("fill") is not None and r is not None and r.width * r.height >= area_min and r.width < pagina.rect.width * 0.95:
            out.append({"rect": [round(v) for v in r], "fill": [round(c, 2) for c in d["fill"]]})
    return out

def volcar(doc, n):
    p = doc[n - 1]
    ls = lineas(p)
    texto = "\n".join(" ¦ ".join(c["t"] for c in l["celdas"]) for l in ls)
    return {"pagina": n, "texto": texto, "filas": filas_tabla(p), "imagenes": imagenes(doc, p)}

if __name__ == "__main__":
    doc = abrir()
    for n in sys.argv[1].split(","):
        if "-" in n:
            a, b = map(int, n.split("-")); ns = range(a, b + 1)
        else:
            ns = [int(n)]
        for k in ns:
            v = volcar(doc, k)
            print(f"=== PAG {k}")
            print(v["texto"])
            if "--filas" in sys.argv:
                for f in v["filas"]: print("FILA", f["celdas"], "| CAB", f["cabecera"])
            if "--cajas" in sys.argv:
                for c in cajas(doc[k - 1]): print("CAJA", c)
            if "--img" in sys.argv:
                for i in v["imagenes"]: print("IMG", i)
