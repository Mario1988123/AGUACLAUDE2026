# Capítulos del catálogo de Corsa (págs. del PDF, no las impresas) y si traen equipos.
CAPITULOS = [
    (1, "Portacartuchos", 22, 43, True),
    (2, "Cartuchos", 44, 57, False),
    (3, "Filtros de lecho", 58, 69, True),
    (4, "Purificación residencial", 70, 91, True),
    (5, "Descalcificación residencial", 92, 103, True),
    (6, "Descalcificación y desnitrificación industrial", 104, 115, True),
    (7, "Filtros especiales resinas", 116, 127, True),
    (8, "Válvulas Keramis", 128, 153, False),
    (9, "Osmosis semi-industrial e industrial", 154, 171, True),
    (10, "Dispensadores de agua", 172, 195, True),
    (11, "Desinfección ultravioleta y ozono", 196, 207, True),
    (12, "Dosificación", 208, 219, True),
    (13, "Equipos de medida, instrumentación y demostración", 220, 233, False),
    (14, "Productos químicos", 234, 247, False),
    (15, "Botellas, tanques y depósitos", 248, 258, False),
]


def capitulo_de(pagina):
    for n, nombre, a, b, eq in CAPITULOS:
        if a <= pagina <= b:
            return {"n": n, "nombre": nombre, "con_equipos": eq}
    return None
