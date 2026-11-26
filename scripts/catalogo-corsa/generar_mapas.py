# Genera, a partir de D:\CORSA\catalogo\productos.json:
#   - gamas.json        (borrador: una gama por modelo de página; cabeza = primera ref; NO pisa si existe, salvo --forzar)
#   - inventario-atributos.json  (cada atributo de Corsa con veces, unidades, grupos, categorías y ejemplos;
#                                 sirve para mantener mapa-atributos.json a mano)
# Uso: python -I -X utf8 scripts/catalogo-corsa/generar_mapas.py [--forzar]
import json, os, sys, collections

AQUI = os.path.dirname(os.path.abspath(__file__))
ORIGEN = r"D:\CORSA\catalogo"
prods = json.load(open(os.path.join(ORIGEN, "productos.json"), encoding="utf8"))["productos"]

# ---------- gamas
f_gamas = os.path.join(AQUI, "gamas.json")
if not os.path.exists(f_gamas) or "--forzar" in sys.argv:
    por_modelo = collections.OrderedDict()
    for p in prods:
        clave = (p["capitulo"], p["modelo"])
        por_modelo.setdefault(clave, []).append(p)
    gamas = []
    for (cap, modelo), ps in por_modelo.items():
        ficha0 = json.load(open(os.path.join(ORIGEN, ps[0]["carpeta"], "ficha.json"), encoding="utf8"))
        gamas.append({
            "modelo": modelo, "capitulo": cap, "subfamilia": ps[0]["subfamilia"], "cabeza": ps[0]["ref"],
            "revisar": bool(ficha0.get("duda")), "nota": ficha0.get("duda"),
            "variantes": [{"ref": p["ref"], "rasgos": p["rasgos"] or None, "nombre_corsa": p["nombre"]} for p in ps],
        })
    json.dump({
        "_leeme": [
            "Gamas de Corsa para el maestro. Lo genera generar_mapas.py (borrador) y ESTE fichero manda: se puede editar.",
            "modelo = nombre de la página del catálogo; va en catalog_products.name y .modelo de todas las variantes (salvo «nombre» propio en la variante).",
            "rasgos = lo que distingue a la variante (catalog_products.rasgos_identificacion).",
            "cabeza = ref que hace de cabeza (gama_id null). Una gama de una sola ref = producto suelto.",
            "revisar = true: el extractor dejó una duda; Mario la tiene que mirar.",
        ],
        "total_refs": len(prods), "total_gamas": len(gamas), "gamas_con_variantes": sum(1 for g in gamas if len(g["variantes"]) > 1),
        "gamas": gamas,
    }, open(f_gamas, "w", encoding="utf8"), ensure_ascii=False, indent=2)
    print("gamas.json escrito:", len(gamas), "gamas")
else:
    print("gamas.json ya existe; no se pisa (usa --forzar)")

# ---------- inventario de atributos
inv = {}
for p in prods:
    ficha = json.load(open(os.path.join(ORIGEN, p["carpeta"], "ficha.json"), encoding="utf8"))
    for g in ficha.get("grupos_ft", []):
        for it in g["items"]:
            k = it["atributo"]
            e = inv.setdefault(k, {"veces": 0, "unidades": collections.Counter(), "grupos": collections.Counter(), "capitulos": collections.Counter(), "ejemplos": []})
            e["veces"] += 1
            e["unidades"][it["unidad"]] += 1
            e["grupos"][g["nombre"]] += 1
            e["capitulos"][f'{p["capitulo"]} / {p["subfamilia"]}'] += 1
            if len(e["ejemplos"]) < 4 and it["valor"] not in [x.split(" @")[0] for x in e["ejemplos"]]:
                e["ejemplos"].append(f'{it["valor"]} {it["unidad"]} @{p["ref"]}'.replace("  ", " "))
out = {k: {**v, "unidades": dict(v["unidades"]), "grupos": dict(v["grupos"]), "capitulos": dict(v["capitulos"])} for k, v in sorted(inv.items(), key=lambda x: -x[1]["veces"])}
json.dump(out, open(os.path.join(AQUI, "inventario-atributos.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
print("inventario-atributos.json:", len(out), "atributos distintos")
fams = collections.Counter(f'{p["capitulo"]} / {p["subfamilia"]}' for p in prods)
for k, v in fams.items(): print(f"  {v:4d}  {k}")
