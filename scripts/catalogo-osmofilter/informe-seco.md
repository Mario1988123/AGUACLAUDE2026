# Informe de la carga de Osmofilter — prueba en seco

Fecha: 2026-11-25T15:05:36.499Z · Estado leído de: api · Solo: todo · Pasos: atributos, productos, gamas, valores, fotos, ventajas, recambios, enlaces, documentos

Generado por `scripts/catalogo-osmofilter/cargar.mjs`. En seco no se ha escrito nada en la base de datos ni en Storage.

> **Migración pendiente.** Faltan columnas de `20261126100000_catalogo_maestro_fase2.sql`. La prueba en seco funciona igual; `--aplicar` se niega a escribir hasta que se aplique.
> - catalog_products: modelo, familia_proveedor, catalogos_proveedor, descatalogado, origen_carga
> - product_attributes_global: grupo
> - catalog_product_photos: thumb_path, etiqueta, width_px, height_px
> - catalog_product_documents: idioma, apartado

## 1. Recuentos

| Qué | N |
|---|---|
| equipos en descarga | 174 |
| equipos procesados | 174 |
| equipos crear | 164 |
| equipos completar | 10 |
| equipos sin cambios | 0 |
| equipos saltados | 0 |
| alias aplicados | RO5063 -> RO5063.1, RO5098 -> RO5098.1 |
| atributos globales nuevos | 84 |
| atributos globales reutilizados | 27 |
| enlaces atributo categoria | 199 |
| valores atributo | 3441 |
| gamas con variantes | 42 |
| variantes a enlazar | 89 |
| fotos | 1016 |
| ventajas | 503 |
| iconos | 68 |
| recambios crear | 556 |
| enlaces recambio crear | 1499 |
| enlaces recambio perdidos | 310 |
| documentos filas | 980 |
| documentos ficheros | 667 |
| filas catalog products tras la carga | 738 |

Comprobación previa: 8611 payloads revisados, 0 fallos (ningún payload lleva version ni company_id; ninguna fila existente recibe name, kind, categoría, fabricante, is_active ni version; solo tablas del maestro).

## 2. Atributos de Osmofilter sin emparejar

Ninguno: los 100 atributos de la descarga tienen entrada en `mapa-atributos.json` (96) o van a columna (Ancho, Alto, Fondo y Peso).

Atributos globales: 84 nuevos, 27 reutilizados, 199 enlaces nuevos atributo–categoría.

Reutilizados: dispenser_cold_prod_lh, dispenser_cold_tank_l, dispenser_cooling_power_w, dispenser_heating_power_w, dispenser_hot_prod_lh, dispenser_hot_tank_l, dispenser_power_total_w, dispenser_refrigerant, osmosis_max_tds_in_ppm, osmosis_pressure_max_bar, osmosis_pressure_min_bar, osmosis_production_gpd, osmosis_temp_max_c, osmosis_temp_min_c, ozone_power_w, softener_bypass_integrated, softener_cycle_capacity_fm3, softener_inlet_outlet_inches, softener_nominal_flow_m3h, softener_regen_type, softener_resin_volume_l, softener_salt_per_regen_kg, softener_temp_max_c, softener_temp_min_c, softener_valve_brand_model, softener_working_pressure_max_bar, softener_working_pressure_min_bar.

Globales existentes a los que se rellena un campo vacío (solo si está en null):
- dispenser_cold_prod_lh: grupo = tecnicas
- dispenser_cold_tank_l: grupo = tecnicas
- dispenser_cooling_power_w: grupo = electricas
- dispenser_heating_power_w: grupo = electricas
- dispenser_hot_prod_lh: grupo = tecnicas
- dispenser_hot_tank_l: grupo = tecnicas
- dispenser_power_total_w: grupo = electricas
- dispenser_refrigerant: grupo = tecnicas
- osmosis_max_tds_in_ppm: grupo = tecnicas
- osmosis_pressure_max_bar: grupo = tecnicas
- osmosis_pressure_min_bar: grupo = tecnicas
- osmosis_production_gpd: grupo = tecnicas
- osmosis_temp_max_c: grupo = tecnicas
- osmosis_temp_min_c: grupo = tecnicas
- ozone_power_w: grupo = electricas
- softener_bypass_integrated: grupo = extra
- softener_cycle_capacity_fm3: grupo = tecnicas, unit = ºHf x m3
- softener_inlet_outlet_inches: grupo = tecnicas
- softener_nominal_flow_m3h: grupo = tecnicas
- softener_regen_type: grupo = extra
- softener_resin_volume_l: grupo = tecnicas
- softener_salt_per_regen_kg: grupo = tecnicas
- softener_temp_max_c: grupo = tecnicas
- softener_temp_min_c: grupo = tecnicas
- softener_valve_brand_model: grupo = tecnicas
- softener_working_pressure_max_bar: grupo = tecnicas
- softener_working_pressure_min_bar: grupo = tecnicas

## 3. Valores que no se han podido convertir

Ninguno.

Valores que no crean fila a propósito (significan «no tiene»):

- Conexión Gas («No» = no tiene): 11
- Capacidad total de almacenamiento («0» = no tiene): 9
- Conexion Rebosadero («No» = no tiene): 9
- Producción («No» = no tiene): 6
- Temperatura del agua caliente («No» = no tiene): 5
- Capacidad del depósito caliente («0» = no tiene): 4
- Capacidad Calentamiento («0» = no tiene): 4
- Conexión agua hidrogenada («No» = no tiene): 3
- Presión de trabajo («No» = no tiene): 1
- Potencia enfriamiento («0» = no tiene): 1
- Depósito banco de hielo («0» = no tiene): 1

Valores que ya estaban en el maestro y **no se pisan** aunque Osmofilter diga otra cosa:

- FRO1046 · dispenser_cold_tank_l: se queda 2 (Osmofilter: 3.5)

## 4. Productos sin foto o sin características

Sin ninguna foto utilizable (ni principal, ni ficha, ni miniatura): 11
- DO6820
- DOL920
- DOL930
- NO6814
- NO6825
- NO7631
- NOL914
- RO5071.2
- HO1116
- HO1117
- FRO1075

Sin características (ni atributos ni medidas): 17
- DO6820
- DOL930
- NO6814
- NO6825
- NO7610
- NO7631
- NOC114
- NOC122
- NOL914
- RO5013
- RO5026
- RO5031
- RO5048
- RO5063
- RO5085
- RO5096
- RO5098

Fotos a subir: 1016 (33 MB de originales, más miniaturas de 400 px). Por tipo: principal 159 · banner 108 · medidas 147 · ficha 151 · ambiente 343 · proyeccion 31 · detalle 77. Mayores de 1.200 px que se reducen: 0.

Ventajas: 503 en 143 productos, 68 iconos distintos, 0 sin icono. Fichas sin ventajas: 31.

## 5. Recambios y enlaces

Recambios distintos en el origen: 556 (20 familias). A crear: 556 (73 consumibles, 483 repuestos). A completar: 0.

Cruce con el Excel (catalogo_infinity_aqua_2026-11-25.xlsx): enlaces solo en el Excel 0, solo en el JSON 0, recambios solo en el Excel 0.

Enlaces equipo→recambio en el origen: 1809. A crear: 1499. Ya existen: 0. Fuera de --solo: 0. **Se pierden: 310** (equipo que no está en el maestro ni en la descarga):

- FRO1004P: 34
- FRO1003P: 25
- RO1056: 22
- FRO1089: 15
- HA0009S: 13
- HA0018S: 13
- HA0026S: 13
- HY0703: 12
- DFL120L: 9
- DFL14L: 9
- DFL170L: 9
- DFL35L: 9
- DFL60L: 9
- RO1072P: 9
- RO1891: 8
- RO1899: 8
- RO1899X06920: 8
- RO1899X6920A: 8
- FRO1097: 7
- NOF114: 7
- NOF135: 7
- DNOVO: 6
- DNOVO2: 6
- DNOVO3: 6
- OZ0052G: 6
- RO1143: 6
- OZ0039: 5
- OZ0046G: 5
- OZ0052: 5
- RO1142: 4
- MI0038: 2
- RO1070: 2
- HO106511: 1
- OZ0040: 1
- VF1062: 1

Equipos descargados sin ningún recambio en el origen (48): DDANA, DDANAP, HO2029, RO1894, RO1896, RO5013, RO5026, RO5028, RO5031, RO5063, RO5085, RO5096, RO5098, RO5111, RO5112, DCAL05, DCAL06, DCAL07, DCAL08, GLA021, HY0700, HY2020, MI0018, OZ0046E, RO1069, RO1078, RO1082, RO1146, RO1172, RO1202, RO1207, RO1209, HO1065, HO1086, HO1087, HO1102, HO1103, HO1109, HO1110, HO1120, HO1121, HO1122, HO1123, HO2027, HO2032, FRO1055, FRO1056, HO1101.

## 6. Documentos

Filas: 980. Ficheros distintos a subir: 667 (1189.1 MB; sin deduplicar serían 2184.4 MB; deduplicado por sha1: sí).
Por apartado: ficha_tecnica 310 · certificado 155 · comercial 238 · manual 267 · guia 10.

## 7. Gamas

42 gamas con variantes y 43 productos sueltos. **Revisar** = dudosa, la tiene que mirar Mario.

| Modelo | Cabeza | Variantes (rasgos) | Revisar | Nota |
|---|---|---|---|---|
| BLUE MOUNTAIN | FRO1046 | FRO1046 (Sobremesa · Ósmosis inversa · c/Bomba)<br>FRO1047 (Ósmosis inversa · c/Bomba)<br>FRO1055 (Sobremesa · Ósmosis inversa · Negro · c/Bomba)<br>FRO1056 (Ósmosis inversa · Negro · c/Bomba)<br>FRO1075 (Ósmosis inversa · Negro · s/Bomba)<br>FRO1059 (Sobremesa · Ultrafiltración)<br>FRO1060 (Ultrafiltración) |  |  |
| BLUE OCEAN | FRO1004 | FRO1004 (Inox · c/Bomba)<br>FRO1003 (Inox · s/Bomba) |  |  |
| BLUE RIVER | FRO1018 | FRO1018 (Filtración · Inox)<br>FRO1018P (Filtración · Inox · c/Pedal) |  |  |
| BLUE SEA 2.0 | FRO1077 | FRO1077 (c/Bomba)<br>FRO1079 (Sobremesa · s/Bomba)<br>FRO1081 (s/Bomba) |  |  |
| BLUE SEA 3.0 | FRO1090 | FRO1090 (Ósmosis inversa · c/Bomba)<br>FRO1104 (Sobremesa · Ósmosis inversa · c/Bomba)<br>FRO1091 (Sobremesa · Ósmosis inversa · s/Bomba)<br>FRO1094 (Ultrafiltración)<br>FRO1098 (Sobremesa · Ultrafiltración)<br>FRO1095 (Vacío (sin tratamiento)) |  |  |
| BLUE SPRING | FRO1064 | FRO1073 (Ósmosis inversa · c/Bomba)<br>FRO1065 (Ósmosis inversa · s/Bomba)<br>FRO1064 (Ultrafiltración) |  |  |
| BLUE STORM | FRO1061 | FRO1062 (Ósmosis inversa · s/Bomba)<br>FRO1117 (Ósmosis inversa · c/Bomba)<br>FRO1061 (Sobremesa · Ósmosis inversa · s/Bomba)<br>FRO1063 (Ultrafiltración) | **Sí** | Osmofilter llama «BLUE STROM» (errata) a FRO1062 y FRO1117; la descripción dice BLUE STORM. Se unen en una gama. |
| COMPACT600 PH | RO1202 | RO1202 (Flujo directo · Blanco)<br>RO1203 (Flujo directo · Negro)<br>RO1214 (Negro · LED) | **Sí** | Mezcla dos familias de Osmofilter: RO1202 y RO1203 son «Flujo directo» y RO1214 «Ósmosis doméstica» (compacto). ¿Misma gama? |
| COSMOS | RO1059 | RO1058 (s/Bomba)<br>RO1059 (c/Bomba)<br>RO1065 (Negro · s/Bomba)<br>RO1066 (Negro · c/Bomba) | **Sí** | Osmofilter llama «COSMOS Negro» a RO1065 y RO1066: se unen con COSMOS y el color va en el rasgo. |
| DANNA | DDANA | DDANA (30 L · Válvula TM68C3 · Azul)<br>DDANAP (30 L · Válvula TM68 PILOT · Azul)<br>DE6835 (35 L · Válvula TM68) | **Sí** | Tres nombres de Osmofilter (DANNA 30 TM68C3, DANNA 30 TM68 PILOT, DANNA TM68). DDANAP se describe como «Custom». |
| DOLMA | DOL920 | DO6820 (20 L · Válvula TM68 · 1")<br>DOL920 (20 L · Válvula TM69 PILOT · 3/4")<br>DOL930 (30 L · Válvula TM69 PILOT · 3/4") | **Sí** | Válvulas distintas (TM68, TM69 PILOT). Osmofilter llama «DOLMA TM69 LED» a DOL920. |
| NOVO TM68 | NO6835 | NO6814 (14 L · 1")<br>NO6825 (25 L · 1")<br>NO6835 (35 L · 1") | **Sí** | NOVO partido por válvula. Alternativa: una sola gama NOVO con la válvula en el rasgo. |
| NOVO TM69 | NO6922 | NO6914 (14 L · 3/4")<br>NO6922 (22 L · 3/4")<br>NO6930 (30 L · 3/4") | **Sí** | NOVO partido por válvula. |
| NOVO TM69 LED | NOL922 | NOL914 (14 L · 3/4")<br>NOL922 (22 L · 3/4")<br>NOL935 (35 L · 3/4") | **Sí** | Nombre de Osmofilter; la descripción dice «TM69 PILOT». NOL914 se llama «Descalcificador NOVO 14L TM69 PILOT 3/4» en Osmofilter. |
| NOVO CLACK | NOC135 | NOC114 (14 L · Contracorriente · 1")<br>NOC122 (22 L · Contracorriente · 1")<br>NOC135 (35 L · Contracorriente · 1") | **Sí** | NOVO partido por válvula. |
| NOVO LOGIX | NO7610 | NO7610 (10 L · 1")<br>NO7631 (ECO · 30 L · s/Boya · s/Chimenea) | **Sí** | NO7631 es «NOVO ECO» (sin boya ni chimenea). ¿Misma gama? |
| NOVO HYDRO | NOHD10 | NOHD10 (10 L · 1" · Digital)<br>NOHD20 (20 L · 1" · Digital)<br>NOHD30 (30 L · 1" · Digital) | **Sí** | NOVO partido por válvula. |
| GLACIAL MECÁNICA | FRO1092 | FRO1092 (Ósmosis inversa · Blanco · c/Bomba)<br>FRO1099 (Ósmosis inversa · Negro · c/Bomba)<br>FRO1096 (Ultrafiltración · Blanco)<br>FRO1101 (Ultrafiltración · Negro) |  |  |
| GLASSGOW | GLA021 | GLA011 (10 L · 3/4" · Negro)<br>GLA021 (20 L · 3/4" · Negro) |  |  |
| MIDEA ECO 5600 | MI0040 | MI0045 (Ósmosis inversa · 2 salidas · c/Bomba)<br>MI0040 (Ósmosis inversa · 2 salidas · s/Bomba)<br>MI0041 (Ultrafiltración · 2 temperaturas) |  |  |
| HORIZON ALKA | HO0001 | HO0001 (s/Bomba)<br>HO0002 (c/Bomba) | **Sí** | Osmofilter llama «HORIZON» a HO0001 y «HORIZON ALKA» a HO0002; las dos descripciones dicen «HORIZON Alka». |
| ICE 40 UP | HO1102 | HO1102 (Pantalla · 2 grifos)<br>HO1118 (Pantalla · 2 grifos · MIRROR)<br>HO1120 (LED · 2 grifos · Negro)<br>HO1103 (Con gas · Pantalla · 2 grifos)<br>HO1119 (Con gas · Pantalla · 2 grifos · MIRROR)<br>HO1121 (Con gas · LED · 2 grifos · Negro) | **Sí** | La «G» de Osmofilter es «con gas» (comprobado con la característica «Agua con gas»). Se ponen en la misma gama con su nombre propio; alternativa: gama aparte «ICE G 40 UP». |
| ICE 80 UP | HO1064 | HO1064 (Pantalla · 2 grifos)<br>HO1082 (Pantalla · 3 grifos)<br>HO1116 (Pantalla · 2 grifos · MIRROR)<br>HO2027 (Mecánico · 2 grifos)<br>HO1109 (LED · 2 grifos · Negro)<br>HO1065 (Con gas · Pantalla · 2 grifos)<br>HO1083 (Con gas · Pantalla · 3 grifos)<br>HO1117 (Con gas · Pantalla · 2 grifos · MIRROR)<br>HO2032 (Con gas · Mecánico · 3 grifos)<br>HO1110 (Con gas · LED · 2 grifos · Negro) | **Sí** | Igual que ICE 40 UP: la «G» es con gas. |
| ICE 80 UNDER | HO1122 | HO1122 (3 salidas)<br>HO1123 (Con gas · 3 salidas) | **Sí** | La «G» es con gas. |
| ICE 110 UP | HO1084 | HO1084 (Pantalla · 3 grifos)<br>HO1085 (Con gas · Pantalla · 3 grifos) | **Sí** | La «G» es con gas. |
| ICE 110 UNDER | HO1086 | HO1086 (3 salidas)<br>HO1087 (Con gas · 3 salidas) | **Sí** | La «G» es con gas. |
| ICEBERG 2.0 | FRO1088 | FRO1088 (c/Bomba)<br>FRO1103 (Negro · c/Bomba)<br>FRO1102 (Sobremesa · Negro · s/Bomba) |  |  |
| LONDRES | RO5062 | RO5062 (Negro)<br>RO5111 (Oro cepillado) |  |  |
| DUBLÍN 2.0 | RO5071.1 | RO5071.1 (Mate)<br>RO5071.2 (Brillo) |  |  |
| DURBAN 2.0 | RO5063.1 | RO5063.1 (Mate)<br>RO5113 (Negro) |  | RO5063 es alias de RO5063.1, que ya existe en el maestro (ver alias.json). |
| PARÍS | RO5102 | RO5102 (Extensible · Mate)<br>RO5066 (Mate)<br>RO5105 (1300 · Mate)<br>RO5021 (Cromo) | **Sí** | Cuatro grifos PARÍS: estándar (cromo), mate, extensible y 1300. ¿Misma gama? |
| GAMA ALTA | RO5028 | RO5028 (Caño corto · Brillo)<br>RO5096 (Caño corto · Mate)<br>RO5013 (Caño largo · Brillo)<br>RO5026 (Caño largo · Mate inox)<br>RO5085 (Caño largo · Negro mate)<br>RO5031 (2 vías · Agua fría/natural) | **Sí** | Grifos «Gama Alta» de Osmofilter sin nombre de modelo. RO5031 es de 2 vías. |
| SERIE ONE KT001 | RO5114 | RO5114 (Mate)<br>RO5116 (Brillo) |  |  |
| MAXI 600GPD | RO1086 | RO1087 (Filtros de 10")<br>RO1086 (Filtros de 20" · s/Manómetro) |  |  |
| MICROTECH UF | RO1078 | RO1069<br>RO1078 (c/Filtro de hidrógeno) |  |  |
| NEOZONE | OZ0046E | OZ0046E (s/Grifo)<br>OZ0046E.G (c/Grifo) |  |  |
| OXYGEN PLUS | OZ0040E | OZ0040E (s/Grifo)<br>OZ0040E.G (c/Grifo) |  |  |
| OXYON | OZ0052E | OZ0052E (Azul · s/Grifo)<br>OZ0052E.G (Azul · c/Grifo)<br>OZ0062E (Gris · s/Grifo)<br>OZ0062E.G (Gris · c/Grifo) |  |  |
| O5 | RO1020 | RO1020 (s/Bomba)<br>RO1021 (2.0 · c/Bomba) |  |  |
| PURE FIVE | RO1047 | RO1047 (c/Bomba)<br>RO1044 (s/Bomba) |  |  |
| PROLIME | DCAL05 | DCAL05<br>DCAL06 (Táctil) |  |  |
| IZZY ALKA | RO1893 | RO1893 (600 GPD · Negro)<br>RO1894 (800 GPD · Negro) |  |  |

Sueltos: BLUE MOUNTAIN HIGH (FRO1116) · ABYSS (AT6928) · ATLANTIS (AT6925) · ALKA FLOW (RO1895) · AQUAPLUS 600 (RO1209) · AQUARION (RO1172) · BLACK STONE (RO1896) · BLUE GLACIAL (FRO1039) · BLUE PACIFIC (FRO1048) · BLUE TECH (FRO1084) · BERLIN 2.0 (RO5048) · BILBAO 2.0 (RO5098.1) · BURDEOS (RO5072) · ECO 15 G UP (HO1101) · ECO 20 (HO2029) · ECO DROP 2.0 (RO1080) · ECO25 ELITE (HO1128) · FRIZZIA (RO5112) · GOLDEN HOOP (RO1131) · H2 SPARK (HY0700) · H2WAVE (HY2020) · INDIC (FRO1093) · LISBOA (RO5064) · MEGA (RO1168P) · METEOR (RO1171) · MIDEA ECO TOUCH 2.0 (MI0037) · MIDEA FRIZZIA (MI0042) · MIDEA H600 (MI0018) · MINISOFT (DM7569) · MÓNACO (RO5050) · PRAGA (RO5108) · PROTECTA (DCAL08) · PROTEX (DCAL07) · QYRO (RO1073P) · RO MOBI (RO1082) · RO MOON (RO1146) · RYDON (RO1207) · SENDA 138 (RO1064) · SERIE ONE KT002 (RO5115) · SILVER BEAST (RO1112) · THIN800 (RO1121) · XT23UF (RO1084) · ZAGREB (RO5089).

## 8. Productos

Crear (164):
- AT6925 · ATLANTIS · softeners/equipment
- AT6928 · ABYSS · softeners/equipment
- DDANA · DANNA · softeners/equipment
- DDANAP · DANNA · softeners/equipment
- DE6835 · DANNA · softeners/equipment
- DM7569 · MINISOFT · softeners/equipment
- DO6820 · DOLMA · softeners/equipment
- DOL920 · DOLMA · softeners/equipment
- DOL930 · DOLMA · softeners/equipment
- FRO1003 · BLUE OCEAN · dispensers/equipment · descatalogado
- FRO1004 · BLUE OCEAN · dispensers/equipment
- FRO1018 · BLUE RIVER · dispensers/equipment
- FRO1018P · BLUE RIVER · dispensers/equipment
- FRO1092 · GLACIAL MECÁNICA · dispensers/equipment
- FRO1096 · GLACIAL MECÁNICA · dispensers/equipment
- FRO1099 · GLACIAL MECÁNICA · dispensers/equipment
- FRO1101 · GLACIAL MECÁNICA · dispensers/equipment
- HO2029 · ECO 20 · dispensers/equipment
- MI0040 · MIDEA ECO 5600 · dispensers/equipment
- MI0041 · MIDEA ECO 5600 · dispensers/equipment
- MI0045 · MIDEA ECO 5600 · dispensers/equipment
- NO6814 · NOVO TM68 · softeners/equipment
- NO6825 · NOVO TM68 · softeners/equipment
- NO6835 · NOVO TM68 · softeners/equipment
- NO6914 · NOVO TM69 · softeners/equipment
- NO6922 · NOVO TM69 · softeners/equipment
- NO6930 · NOVO TM69 · softeners/equipment
- NO7610 · NOVO LOGIX · softeners/equipment
- NO7631 · NOVO LOGIX · softeners/equipment
- NOC114 · NOVO CLACK · softeners/equipment
- NOC122 · NOVO CLACK · softeners/equipment
- NOC135 · NOVO CLACK · softeners/equipment
- NOHD10 · NOVO HYDRO · softeners/equipment
- NOHD20 · NOVO HYDRO · softeners/equipment
- NOHD30 · NOVO HYDRO · softeners/equipment
- NOL914 · NOVO TM69 LED · softeners/equipment
- NOL922 · NOVO TM69 LED · softeners/equipment
- NOL935 · NOVO TM69 LED · softeners/equipment
- OZ0040E · OXYGEN PLUS · ozone/equipment
- OZ0040E.G · OXYGEN PLUS · ozone/equipment
- RO1020 · O5 · osmosis_5_stages/equipment · descatalogado
- RO1021 · O5 2.0 · osmosis_5_stages/equipment · descatalogado
- RO1044 · PURE FIVE · osmosis_5_stages/equipment
- RO1047 · PURE FIVE · osmosis_5_stages/equipment
- RO1058 · COSMOS · osmosis_compact/equipment
- RO1059 · COSMOS · osmosis_compact/equipment
- RO1080 · ECO DROP 2.0 · osmosis_direct_flow/equipment
- RO1084 · XT23UF · filters/equipment
- RO1086 · MAXI 600GPD · osmosis/equipment
- RO1087 · MAXI 600GPD · osmosis/equipment
- RO1893 · IZZY 600 ALKA · osmosis_direct_flow/equipment
- RO1894 · IZZY 800 ALKA · osmosis_direct_flow/equipment · descatalogado
- RO1896 · BLACK STONE · osmosis_direct_flow/equipment
- RO5013 · GAMA ALTA · Grifos/accessory
- RO5021 · PARÍS · Grifos/accessory
- RO5026 · GAMA ALTA · Grifos/accessory
- RO5028 · GAMA ALTA · Grifos/accessory
- RO5031 · GAMA ALTA · Grifos/accessory
- RO5050 · MÓNACO · Grifos/accessory
- RO5062 · LONDRES · Grifos/accessory
- RO5066 · PARÍS · Grifos/accessory
- RO5071.1 · DUBLÍN 2.0 · Grifos/accessory
- RO5071.2 · DUBLÍN 2.0 · Grifos/accessory · descatalogado
- RO5072 · BURDEOS · Grifos/accessory
- RO5085 · GAMA ALTA · Grifos/accessory
- RO5096 · GAMA ALTA · Grifos/accessory
- RO5105 · PARÍS · Grifos/accessory
- RO5108 · PRAGA · Grifos/accessory
- RO5111 · LONDRES · Grifos/accessory
- RO5114 · SERIE ONE KT001 · Grifos/accessory
- RO5115 · SERIE ONE KT002 · Grifos/accessory
- RO5116 · SERIE ONE KT001 · Grifos/accessory
- HO0001 · HORIZON ALKA · osmosis_compact/equipment
- HO0002 · HORIZON ALKA · osmosis_compact/equipment
- MI0042 · MIDEA FRIZZIA · horeca/equipment · descatalogado
- OZ0052E · OXYON · ozone/equipment
- OZ0052E.G · OXYON · ozone/equipment
- OZ0062E · OXYON · ozone/equipment
- OZ0062E.G · OXYON · ozone/equipment
- RO1064 · SENDA 138 · osmosis_direct_flow/equipment
- RO1065 · COSMOS · osmosis_compact/equipment
- RO1066 · COSMOS · osmosis_compact/equipment
- RO1112 · SILVER BEAST · osmosis_direct_flow/equipment · descatalogado
- RO1121 · THIN800 · osmosis_direct_flow/equipment
- RO1131 · GOLDEN HOOP · osmosis_direct_flow/equipment
- RO1168P · MEGA · osmosis_direct_flow/equipment
- RO1171 · METEOR · osmosis_direct_flow/equipment
- RO1203 · COMPACT600 PH · osmosis_direct_flow/equipment
- RO1214 · COMPACT600 PH · osmosis_compact/equipment
- RO5112 · FRIZZIA · Grifos/accessory
- DCAL05 · PROLIME · descalers/equipment
- DCAL06 · PROLIME TOUCH · descalers/equipment
- DCAL07 · PROTEX · descalers/equipment
- DCAL08 · PROTECTA · descalers/equipment
- GLA011 · GLASSGOW · softeners/equipment
- GLA021 · GLASSGOW · softeners/equipment
- HY0700 · H2 SPARK · hydrogen/equipment
- HY2020 · H2WAVE · hydrogen/equipment
- MI0018 · MIDEA H600 · osmosis_direct_flow/equipment
- OZ0046E · NEOZONE · ozone/equipment
- OZ0046E.G · NEOZONE · ozone/equipment
- RO1069 · MICROTECH UF · filters/equipment · descatalogado
- RO1078 · MICROTECH UF · filters/equipment
- RO1082 · RO MOBI · dispensers/equipment
- RO1146 · RO MOON · dispensers/equipment
- RO1172 · AQUARION · osmosis_direct_flow/equipment
- RO1202 · COMPACT600 PH · osmosis_direct_flow/equipment
- RO1207 · RYDON · osmosis_direct_flow/equipment
- RO1209 · AQUAPLUS 600 · osmosis_direct_flow/equipment
- RO1895 · ALKA FLOW · osmosis_direct_flow/equipment
- RO5113 · DURBAN 2.0 · Grifos/accessory
- HO1064 · ICE 80 UP · horeca/equipment
- HO1065 · ICE G 80 UP · horeca/equipment
- HO1082 · ICE 80 UP · horeca/equipment
- HO1083 · ICE G 80 UP · horeca/equipment
- HO1084 · ICE 110 UP · horeca/equipment
- HO1085 · ICE G 110 UP · horeca/equipment
- HO1086 · ICE 110 UNDER · horeca/equipment
- HO1087 · ICE G 110 UNDER · horeca/equipment
- HO1102 · ICE 40 UP · horeca/equipment
- HO1103 · ICE G 40 UP · horeca/equipment
- HO1109 · ICE 80 UP · horeca/equipment
- HO1110 · ICE G 80 UP · horeca/equipment
- HO1116 · ICE 80 UP · horeca/equipment
- HO1117 · ICE G 80 UP · horeca/equipment
- HO1118 · ICE 40 UP · horeca/equipment
- HO1119 · ICE G 40 UP · horeca/equipment
- HO1120 · ICE 40 UP · horeca/equipment
- HO1121 · ICE G 40 UP · horeca/equipment
- HO1122 · ICE 80 UNDER · horeca/equipment
- HO1123 · ICE G 80 UNDER · horeca/equipment
- HO2027 · ICE 80 UP · horeca/equipment
- HO2032 · ICE G 80 UP · horeca/equipment
- FRO1039 · BLUE GLACIAL · dispensers/equipment · descatalogado
- FRO1047 · BLUE MOUNTAIN · dispensers/equipment
- FRO1048 · BLUE PACIFIC · dispensers/equipment · descatalogado
- FRO1055 · BLUE MOUNTAIN · dispensers/equipment
- FRO1056 · BLUE MOUNTAIN · dispensers/equipment
- FRO1059 · BLUE MOUNTAIN · dispensers/equipment
- FRO1060 · BLUE MOUNTAIN · dispensers/equipment
- FRO1061 · BLUE STORM · dispensers/equipment
- FRO1062 · BLUE STORM · dispensers/equipment
- FRO1063 · BLUE STORM · dispensers/equipment · descatalogado
- FRO1064 · BLUE SPRING · dispensers/equipment
- FRO1065 · BLUE SPRING · dispensers/equipment
- FRO1073 · BLUE SPRING · dispensers/equipment
- FRO1075 · BLUE MOUNTAIN · dispensers/equipment
- FRO1077 · BLUE SEA 2.0 · dispensers/equipment
- FRO1079 · BLUE SEA 2.0 · dispensers/equipment
- FRO1081 · BLUE SEA 2.0 · dispensers/equipment · descatalogado
- FRO1084 · BLUE TECH · dispensers/equipment
- FRO1088 · ICEBERG 2.0 · dispensers/equipment
- FRO1090 · BLUE SEA 3.0 · dispensers/equipment
- FRO1091 · BLUE SEA 3.0 · dispensers/equipment
- FRO1094 · BLUE SEA 3.0 · dispensers/equipment
- FRO1095 · BLUE SEA 3.0 · dispensers/equipment
- FRO1098 · BLUE SEA 3.0 · dispensers/equipment
- FRO1102 · ICEBERG 2.0 · dispensers/equipment
- FRO1103 · ICEBERG 2.0 · dispensers/equipment
- FRO1104 · BLUE SEA 3.0 · dispensers/equipment
- FRO1116 · BLUE MOUNTAIN HIGH · dispensers/equipment
- FRO1117 · BLUE STORM · dispensers/equipment
- HO1101 · ECO 15 G UP · horeca/equipment · descatalogado
- MI0037 · MIDEA ECO TOUCH 2.0 · dispensers/equipment

Completar (10):
- RO5048: modelo, familia_proveedor, catalogos_proveedor, origen_carga
- RO5063.1 (descarga RO5063): modelo, familia_proveedor, catalogos_proveedor, origen_carga
- RO5064: modelo, familia_proveedor, catalogos_proveedor, origen_carga, long_description, weight_grams
- RO5089: modelo, familia_proveedor, catalogos_proveedor, origen_carga, long_description, weight_grams
- RO5098.1 (descarga RO5098): modelo, familia_proveedor, catalogos_proveedor, origen_carga
- RO5102: modelo, familia_proveedor, catalogos_proveedor, origen_carga, long_description, weight_grams
- RO1073P: modelo, familia_proveedor, catalogos_proveedor, origen_carga
- FRO1046: modelo, familia_proveedor, catalogos_proveedor, origen_carga, long_description
- FRO1093: modelo, familia_proveedor, catalogos_proveedor, origen_carga, long_description, weight_grams
- HO1128: modelo, familia_proveedor, catalogos_proveedor, origen_carga, long_description, weight_grams

## 9. Conflictos y avisos

Conflictos:
- (ninguno)

Avisos:
- RO5064: dim_height_mm se queda en 410 (Osmofilter: 415)
- RO1073P: dim_width_mm se queda en 40 (Osmofilter: 153)
- RO1073P: dim_height_mm se queda en 40 (Osmofilter: 333)
- RO1073P: dim_depth_mm se queda en 445 (Osmofilter: 461)
- RO1073P: weight_grams se queda en 10 (Osmofilter: 8700)
- FRO1046: dim_depth_mm se queda en 410 (Osmofilter: 400)
- FRO1046: weight_grams se queda en 10 (Osmofilter: 15800)
- HO1128: se queda en Gas/accessory (Osmofilter: horeca/equipment); no se toca
- NO7610: sin principal.webp, la principal será «miniatura»
- NOC114: sin principal.webp, la principal será «miniatura»
- NOC122: sin principal.webp, la principal será «miniatura»
- NOC135: sin principal.webp, la principal será «miniatura»
- RO5013: sin principal.webp, la principal será «miniatura»
- RO5026: sin principal.webp, la principal será «miniatura»
- RO5031: sin principal.webp, la principal será «miniatura»
- RO5085: sin principal.webp, la principal será «miniatura»
- RO5096: sin principal.webp, la principal será «miniatura»
- RO5113: sin principal.webp, la principal será «ficha»
- RO5102: ya tiene ficha técnica subida a mano; no se añade «Ficha técnica - ES.pdf»
- RO5102: ya tiene ficha técnica subida a mano; no se añade «Ficha técnica - EN.pdf»
- FRO1046: ya tiene ficha técnica subida a mano; no se añade «Ficha técnica - ES.pdf»
- FRO1046: ya tiene ficha técnica subida a mano; no se añade «Ficha técnica - EN.pdf»
- FRO1093: ya tiene ficha técnica subida a mano; no se añade «Ficha técnica - ES.pdf»
- FRO1093: ya tiene ficha técnica subida a mano; no se añade «Ficha técnica - EN.pdf»

