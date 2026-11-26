# =============================================================================
# Construye D:\CORSA\catalogo a partir de la extracción del PDF de Corsa.
#   Entrada: D:\CORSA\catalogo\_extraccion\*.json (una por bloque de capítulos)
#   Salida:  D:\CORSA\catalogo\productos.json
#            D:\CORSA\catalogo\descartados.json
#            D:\CORSA\catalogo\<capítulo>\<REF - NOMBRE>\ficha.json + imagenes\*.webp
# Misma estructura que D:\OSMONOVA\catalogo. No toca la base de datos.
#
# Uso: python -I -X utf8 scripts/catalogo-corsa/construir.py [--sin-imagenes]
# =============================================================================
import io, json, os, re, sys, glob, datetime, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pymupdf as fitz
from PIL import Image
from capitulos import CAPITULOS, capitulo_de
import pdf_util

DESTINO = r"D:\CORSA\catalogo"
EXTRACCION = os.path.join(DESTINO, "_extraccion")
SIN_IMAGENES = "--sin-imagenes" in sys.argv
GRUPOS = {"fisicas": ("Características físicas", 20), "electricas": ("Características eléctricas", 30),
          "tecnicas": ("Características técnicas", 40), "extra": ("Características extra", 60)}
RE_COD = re.compile(r"^[A-Z]{1,2}-\d{5,7}[A-Z]?$")
EXCLUIR = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "excluir.json"), encoding="utf8"))["reglas"]
APARTE = os.path.join(DESTINO, "_descartados_industrial")


def motivo_exclusion(ref, capitulo, modelo):
    for r in EXCLUIR:
        if ref in r.get("refs", []):
            return r["motivo"]
        if r.get("capitulo") == capitulo and ("modelos" not in r or modelo in r["modelos"]):
            return r["motivo"]
    return None


def nombre_fichero(s):
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f”“]', "", str(s)).strip().rstrip(".")
    return re.sub(r"\s+", " ", s)[:90]


def a_webp(img, destino, calidad=92):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.mode or img.mode == "P" else "RGB")
    img.save(destino, "WEBP", quality=calidad, method=6)
    return img.size


_cache = {}


def imagen_xref(doc, xref):
    """Imagen nativa del PDF con su transparencia (smask) si la tiene. Devuelve PIL.Image."""
    if xref in _cache:
        return _cache[xref]
    info = doc.xref_get_key(xref, "SMask")
    pix = fitz.Pixmap(doc, xref)
    if pix.colorspace and pix.colorspace.n >= 4:  # CMYK -> RGB
        pix = fitz.Pixmap(fitz.csRGB, pix)
    smask = None
    if info and info[0] == "xref":
        smask = int(info[1].split()[0])
    if smask:
        try:
            m = fitz.Pixmap(doc, smask)
            if pix.alpha:
                pix = fitz.Pixmap(pix, 0)
            pix = fitz.Pixmap(pix, m)
        except Exception as e:  # máscara con otro tamaño: se queda sin transparencia
            print(f"  aviso: smask {smask} de {xref} no aplicable: {e}")
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    img.load()
    _cache[xref] = img
    return img


def imagen_clip(doc, pagina, clip, dpi=300):
    p = doc[pagina - 1]
    pix = p.get_pixmap(clip=fitz.Rect(*clip), dpi=dpi)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    img.load()
    return img


def fusionar(comunes, propias):
    """Características: las de la variante mandan sobre las comunes con el mismo nombre."""
    out, idx = [], {}
    for c in (comunes or []) + (propias or []):
        k = (c.get("atributo") or "").strip()
        if not k:
            continue
        item = {"grupo": c.get("grupo") or "tecnicas", "atributo": k, "valor": str(c.get("valor", "")).strip(), "unidad": (c.get("unidad") or "").strip()}
        if k in idx:
            out[idx[k]] = item
        else:
            idx[k] = len(out)
            out.append(item)
    return out


def main():
    # Sin el PDF (se ha movido o borrado) se reconstruye con las imágenes ya extraídas y los
    # descartados automáticos de la pasada anterior.
    doc = pdf_util.abrir() if os.path.exists(pdf_util.PDF) else None
    previo = json.load(open(os.path.join(DESTINO, "descartados.json"), encoding="utf8")) if os.path.exists(os.path.join(DESTINO, "descartados.json")) else {"descartados": [], "sin_clasificar": []}
    if doc is None:
        print("aviso: no está el PDF; se reutilizan las imágenes ya extraídas y los descartados automáticos anteriores")
    entradas = sorted(f for f in glob.glob(os.path.join(EXTRACCION, "*.json")))
    familias, descartados, notas = [], [], []
    for f in entradas:
        d = json.load(open(f, encoding="utf8"))
        for fam in d.get("familias", []):
            fam["_encargo"] = d.get("encargo") or os.path.basename(f)
            familias.append(fam)
        descartados += [{**x, "encargo": d.get("encargo")} for x in d.get("descartados", [])]
        notas += [f"{d.get('encargo')}: {n}" for n in d.get("notas", [])]

    productos, sin_ref, refs_vistas, avisos, excluidos = [], [], {}, [], []
    stats = {"fotos": 0, "por_tipo": {}}
    for fam in familias:
        cap = capitulo_de((fam.get("paginas") or [0])[0])
        capitulo = cap["nombre"] if cap else fam.get("familia")
        for v in fam.get("variantes", []):
            ref = (v.get("ref") or "").strip()
            if not ref:
                mot = motivo_exclusion(None, capitulo, fam.get("modelo"))
                if mot:
                    excluidos.append({"pagina": (fam.get("paginas") or [None])[0], "ref": None, "nombre": f"{fam.get('modelo')} · {v.get('modelo_corsa')}", "motivo": mot + " (sin código)", "de_la_gama": fam.get("modelo"), "encargo": "excluir.json"})
                    continue
                sin_ref.append({"modelo": fam.get("modelo"), "modelo_corsa": v.get("modelo_corsa"), "paginas": fam.get("paginas")})
                continue
            if not RE_COD.match(ref):
                avisos.append(f"{ref}: el código no tiene el formato de Corsa (X-000000)")
            if ref in refs_vistas:
                avisos.append(f"{ref}: repetida en {refs_vistas[ref]} y {fam.get('modelo')}; se queda la primera")
                continue
            refs_vistas[ref] = fam.get("modelo")
            nombre = (v.get("modelo_corsa") or fam.get("modelo") or ref).strip()
            carpeta = nombre_fichero(f"{ref} - {nombre}")
            dir_prod = os.path.join(DESTINO, nombre_fichero(capitulo), carpeta)
            mot = motivo_exclusion(ref, capitulo, fam.get("modelo"))
            if mot:
                if os.path.isdir(dir_prod):  # de una pasada anterior: se aparta, no se borra
                    dest = os.path.join(APARTE, nombre_fichero(capitulo), carpeta)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    if not os.path.exists(dest):
                        shutil.move(dir_prod, dest)
                excluidos.append({"pagina": (fam.get("paginas") or [None])[0], "ref": ref, "nombre": f"{fam.get('modelo')} · {nombre}", "motivo": mot, "de_la_gama": fam.get("modelo"), "encargo": "excluir.json", "cabecera": f"{capitulo} / {fam.get('subfamilia')}"})
                continue
            os.makedirs(dir_prod, exist_ok=True)
            carac = fusionar(fam.get("caracteristicas"), v.get("caracteristicas"))
            grupos_ft = []
            for g, (nom, orden) in GRUPOS.items():
                items = [{"atributo": c["atributo"], "unidad": c["unidad"], "valor": c["valor"]} for c in carac if c["grupo"] == g]
                if items:
                    grupos_ft.append({"nombre": nom, "orden": orden, "items": items})
            otros = sorted({c["grupo"] for c in carac} - set(GRUPOS))
            if otros:
                avisos.append(f"{ref}: grupos desconocidos {otros} (se pasan a técnicas)")
                items = [{"atributo": c["atributo"], "unidad": c["unidad"], "valor": c["valor"]} for c in carac if c["grupo"] in otros]
                tec = next((g for g in grupos_ft if g["orden"] == 40), None)
                if tec: tec["items"] += items
                else: grupos_ft.append({"nombre": "Características técnicas", "orden": 40, "items": items})
                grupos_ft.sort(key=lambda g: g["orden"])

            # imágenes: las de la variante mandan; la principal de la gama solo si la variante no trae la suya
            imgs_var = v.get("imagenes") or []
            imgs = list(imgs_var)
            tiene_principal = any(i.get("tipo") == "principal" for i in imgs_var)
            for i in fam.get("imagenes") or []:
                if i.get("tipo") == "principal" and tiene_principal:
                    continue
                imgs.append(i)
            archivos, imagenes_ficha, cont = [], [], {"ambiente": 0, "detalle": 0, "principal": 0, "medidas": 0}
            for i in imgs:
                tipo = i.get("tipo")
                if tipo not in cont:
                    avisos.append(f"{ref}: imagen con tipo desconocido «{tipo}»"); continue
                cont[tipo] += 1
                if tipo == "principal" and cont[tipo] > 1:
                    tipo = "detalle"; cont["detalle"] += 1
                if tipo == "medidas" and cont["medidas"] > 1:
                    tipo = "detalle"; cont["detalle"] += 1
                rel = {"principal": "imagenes/principal.webp", "medidas": "imagenes/medidas.webp",
                       "ambiente": f"imagenes/ambiente-{cont['ambiente']}.webp",
                       "detalle": f"imagenes/detalles/detalle-{cont['detalle']}.webp"}[tipo]
                origen = {"pagina": i.get("pagina"), **({"xref": i["xref"]} if i.get("xref") else {"clip": i.get("clip")})}
                ancho = alto = None
                transparencia = None
                if doc is None:
                    destino_img = os.path.join(dir_prod, rel)
                    if not os.path.exists(destino_img):
                        avisos.append(f"{ref}: sin PDF y sin imagen previa para {origen}"); continue
                    with Image.open(destino_img) as im_prev:
                        ancho, alto = im_prev.size
                        transparencia = im_prev.mode in ("RGBA", "LA")
                elif not SIN_IMAGENES:
                    try:
                        img = imagen_xref(doc, i["xref"]) if i.get("xref") else imagen_clip(doc, i["pagina"], i["clip"])
                        ancho, alto = a_webp(img, os.path.join(dir_prod, rel))
                        transparencia = img.mode in ("RGBA", "LA")
                    except Exception as e:
                        avisos.append(f"{ref}: no se pudo extraer {origen}: {e}"); continue
                archivos.append(rel)
                imagenes_ficha.append({"fichero": rel, "tipo": tipo, "nota": i.get("nota"), "origen": origen, "ancho": ancho, "alto": alto, "transparencia": transparencia})
                stats["fotos"] += 1
                stats["por_tipo"][tipo] = stats["por_tipo"].get(tipo, 0) + 1

            ficha = {
                "ref": ref, "codigo_corsa": ref, "nombre": nombre, "modelo": fam.get("modelo"),
                "modelo_corsa": v.get("modelo_corsa"), "rasgos": v.get("rasgos") or "",
                "familia": fam.get("familia") or capitulo, "capitulo": capitulo, "subfamilia": fam.get("subfamilia"),
                "paginas": fam.get("paginas"), "descripcion": fam.get("descripcion"),
                "highlights": [{"texto_breve": h.get("texto_breve"), "texto_largo": h.get("texto_largo")} for h in fam.get("ventajas") or []],
                "etapas": fam.get("etapas") or [], "grupos_ft": grupos_ft, "imagenes": imagenes_ficha,
                "duda": fam.get("duda"), "encargo": fam.get("_encargo"),
            }
            json.dump(ficha, open(os.path.join(dir_prod, "ficha.json"), "w", encoding="utf8"), ensure_ascii=False, indent=2)
            archivos.append("ficha.json")
            productos.append({
                "ref": ref, "nombre": nombre, "modelo": fam.get("modelo"), "rasgos": v.get("rasgos") or "",
                "familia": fam.get("familia") or capitulo, "capitulo": capitulo, "subfamilia": fam.get("subfamilia"),
                "paginas": fam.get("paginas"), "carpeta": os.path.relpath(dir_prod, DESTINO).replace("\\", "/"),
                "descripcion": fam.get("descripcion"),
                "caracteristicas": {f"{GRUPOS.get(c['grupo'], ('Características técnicas',))[0]} · {c['atributo']}": f"{c['valor']} {c['unidad']}".strip() for c in carac},
                "ventajas": [h.get("texto_breve") for h in fam.get("ventajas") or []],
                "archivos": archivos, "duda": fam.get("duda"),
            })

    # descartados: los de los extractores + todas las filas con código de los capítulos sin equipos
    descartados = excluidos + descartados
    vistos = {d.get("ref") for d in descartados if d.get("ref")}
    if doc is None:
        for d in previo["descartados"]:
            if d.get("encargo") == "auto" and d.get("ref") not in vistos:
                vistos.add(d.get("ref")); descartados.append(d)
    for n, nombre, a, b, con_eq in (CAPITULOS if doc is not None else []):
        for pg in range(a, b + 1):
            p = doc[pg - 1]
            sub = (p.get_text().strip().split("\n") or [""])[0]
            for fila in pdf_util.filas_tabla(p):
                ref = fila["celdas"][0].split(" ")[0]
                if con_eq or ref in vistos:
                    continue
                vistos.add(ref)
                descartados.append({"pagina": pg, "ref": ref, "nombre": " · ".join(fila["celdas"][1:3]), "motivo": f"capítulo {n} ({nombre}): no es equipo", "de_la_gama": None, "encargo": "auto", "cabecera": sub})
    # filas con código de los capítulos con equipos que no están ni en equipos ni en descartados
    sin_clasificar = [] if doc is not None else [x for x in previo.get("sin_clasificar", []) if x["ref"] not in vistos and x["ref"] not in refs_vistas]
    for n, nombre, a, b, con_eq in (CAPITULOS if doc is not None else []):
        if not con_eq: continue
        for pg in range(a, b + 1):
            for fila in pdf_util.filas_tabla(doc[pg - 1]):
                ref = fila["celdas"][0].split(" ")[0]
                if ref not in refs_vistas and ref not in vistos and ref not in {x["ref"] for x in excluidos}:
                    sin_clasificar.append({"pagina": pg, "ref": ref, "fila": fila["celdas"]})

    os.makedirs(DESTINO, exist_ok=True)
    json.dump({"generado": datetime.datetime.now().isoformat(timespec="seconds"), "origen": pdf_util.PDF,
               "total": len(productos), "productos": productos, "sin_ref": sin_ref, "avisos": avisos, "notas": notas},
              open(os.path.join(DESTINO, "productos.json"), "w", encoding="utf8"), ensure_ascii=False, indent=2)
    json.dump({"total": len(descartados), "descartados": sorted(descartados, key=lambda x: (x.get("pagina") or 0, x.get("ref") or "")),
               "sin_clasificar": sin_clasificar},
              open(os.path.join(DESTINO, "descartados.json"), "w", encoding="utf8"), ensure_ascii=False, indent=2)
    por_cap = {}
    for p in productos: por_cap[p["capitulo"]] = por_cap.get(p["capitulo"], 0) + 1
    print(json.dumps({"productos": len(productos), "gamas": len(familias), "por_capitulo": por_cap, "fotos": stats,
                      "sin_ref": len(sin_ref), "excluidos_industrial": len(excluidos), "descartados": len(descartados), "sin_clasificar": len(sin_clasificar), "avisos": avisos[:40]}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
