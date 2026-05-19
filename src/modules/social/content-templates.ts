// =============================================================================
// content-templates.ts
// Catálogo de PLANTILLAS de contenido para el módulo RRSS.
//
// Cada plantilla es atemporal — usa placeholders {{brand_name}},
// {{brand_hashtag}}, {{ephemeris_name}}, {{ephemeris_date}} que el generador
// sustituye con datos de la empresa y del mes.
//
// Categorías (rotación interna):
//   - educational         (8 plantillas)
//   - commercial_soft     (6 plantillas)
//   - technical_authority (6 plantillas)
//   - local               (4 plantillas)
//   - visual_reel         (3 plantillas)
//   - ephemeris           (por slug de efeméride, fases 1/2/3)
// =============================================================================

export type ContentType =
  | "educational"
  | "commercial_soft"
  | "technical_authority"
  | "local"
  | "visual_reel"
  | "ephemeris";

export type Channel =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "tiktok"
  | "google_business"
  | "blog"
  | "newsletter";

export interface ContentTemplate {
  id: string;
  content_type: ContentType;
  /** Canales sugeridos. El generador adapta el copy si hace falta. */
  channels: Channel[];
  target_segment?: "hogar" | "empresa" | "hosteleria" | "comunidad" | "administradores" | "general";
  /** Si esta plantilla es de efeméride, el slug que activa. */
  ephemeris_slug?: string;
  campaign_phase?: 1 | 2 | 3;
  topic: string;
  copy_main: string;
  copy_short?: string;
  copy_linkedin?: string;
  cta: string;
  hashtags_extra: string[];
  image_prompt: string;
  image_prompt_alt?: string;
  image_alt: string;
  image_format: string;
  intent_level: "low" | "medium" | "high";
  /** SEO si es blog */
  seo_title?: string;
  seo_meta_description?: string;
  seo_excerpt?: string;
  /** Newsletter */
  email_subject?: string;
}

// =============================================================================
// EDUCATIVAS (rotación atemporal)
// =============================================================================

export const EDUCATIONAL: ContentTemplate[] = [
  {
    id: "edu-cal-en-casa",
    content_type: "educational",
    channels: ["instagram", "facebook"],
    target_segment: "hogar",
    topic: "Cómo saber si el agua de tu casa tiene mucha cal",
    copy_main:
      "La cal no avisa. Aparece poco a poco hasta que un día te das cuenta de que el grifo, la mampara y el calentador llevan meses sufriendo.\n\n5 señales claras de cal alta en casa:\n· Manchas blancas secas en grifería y mampara\n· El jabón cuesta más en hacer espuma\n· Pelo y piel más ásperos tras la ducha\n· Tetera/cafetera con costra blanca interior\n· Calentador que tarda más y consume más\n\n¿Tu casa tiene alguna? Cuéntanoslo abajo 👇",
    copy_short: "5 señales de cal en casa: manchas blancas, menos espuma, pelo áspero, costra en tetera, calentador lento.",
    cta: "Pide análisis del agua de tu zona sin compromiso 💧",
    hashtags_extra: [
      "#Descalcificador",
      "#AguaSinCal",
      "#CalidadDelAgua",
      "#AhorroEnergetico",
      "#HogarCuidado",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080 estilo editorial limpio. Vista cercana de grifo cromado moderno con manchas blancas de cal visibles (realistas, no exageradas). Iluminación natural suave de baño. Fondo de azulejo claro desenfocado. Paleta gris-acero + azul agua + blanco. Sin marcas en el grifo, sin personas, sin logos. Texto integrado pequeño inferior: 'Detecta la cal a tiempo'.",
    image_alt: "Grifo con manchas blancas de cal en un lavabo moderno.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  {
    id: "edu-osmosis-explicada",
    content_type: "educational",
    channels: ["instagram", "facebook"],
    target_segment: "general",
    topic: "Qué es la ósmosis inversa (explicada en simple)",
    copy_main:
      "La ósmosis inversa suena complicada pero es simple:\n\n💧 El agua pasa a través de una membrana con poros mil veces más pequeños que una bacteria.\n💧 Solo el agua atraviesa. Sales, cloro, metales pesados y la mayoría de contaminantes quedan fuera.\n💧 Resultado: agua casi pura para beber y cocinar.\n\nPor qué cada vez más casas la instalan:\n· Mejor sabor que cualquier botella\n· Cero plástico que llevar/almacenar\n· Coste por litro mucho menor a largo plazo\n· Olvidarte de comprar agua\n\n¿La tienes ya en casa o te lo estás planteando?",
    copy_short: "Ósmosis inversa: una membrana fina filtra hasta moléculas. Agua casi pura sin comprar botellas.",
    cta: "Te explicamos sin compromiso si te conviene →",
    hashtags_extra: [
      "#OsmosisInversa",
      "#AguaPotable",
      "#SinPlastico",
      "#AguaPura",
      "#AguaEnCasa",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080 estilo infográfico premium. Sección transversal estilizada de un equipo de ósmosis inversa: agua entrando por izquierda, membrana en el centro, agua pura saliendo a la derecha, residuos al desagüe abajo. Estética flat moderna con sombras suaves. Paleta azul agua + blanco + verde acento. Etiquetas pequeñas: 'Agua red → Membrana → Agua pura'. Sin marcas comerciales, sin logos.",
    image_alt: "Esquema didáctico de un equipo de ósmosis inversa con flujo de agua entrante y agua filtrada saliente.",
    image_format: "1080x1080",
    intent_level: "low",
  },
  {
    id: "edu-diferencias-tecnologias",
    content_type: "educational",
    channels: ["instagram", "facebook"],
    target_segment: "general",
    topic: "Diferencia entre agua filtrada, descalcificada y osmotizada",
    copy_main:
      "Filtración, descalcificación y ósmosis NO son lo mismo. Elegir bien depende de lo que necesites:\n\n🟦 Filtración → mejora sabor, reduce cloro y partículas. Inversión baja.\n🟦 Descalcificación → reduce cal en TODA la casa. Protege tuberías y electrodomésticos.\n🟦 Ósmosis inversa → agua casi pura para beber y cocinar. Sustituye al agua embotellada.\n\nLo más común: combinar descalcificador general + ósmosis en cocina.\n\n¿Qué te preocupa más: sabor, electrodomésticos o ahorro de plástico?",
    copy_short: "Filtrar, descalcificar, osmotizar — tres tecnologías, tres objetivos.",
    cta: "Te asesoramos sin compromiso sobre lo que tu casa necesita 💧",
    hashtags_extra: [
      "#OsmosisInversa",
      "#Descalcificador",
      "#FiltracionDeAgua",
      "#AguaPotable",
      "#Educativo",
    ],
    image_prompt:
      "Infografía cuadrada 1080x1080. Tres bloques horizontales iguales, cada uno con un icono minimalista: filtro de cartucho, válvula de descalcificador, equipo de ósmosis. Bajo cada icono, una frase corta. Paleta azul agua + blanco + verde acento, estilo flat editorial. Fondo blanco roto. Sin logos.",
    image_alt: "Comparación visual de tres tecnologías de tratamiento de agua: filtración, descalcificación y ósmosis inversa.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  {
    id: "edu-mantenimiento-descalcificador",
    content_type: "educational",
    channels: ["instagram", "facebook"],
    target_segment: "hogar",
    topic: "Cuándo conviene revisar tu descalcificador",
    copy_main:
      "Un descalcificador no es 'instalarlo y olvidarte'. Como cualquier equipo, necesita revisión periódica:\n\n✓ Cada 6 meses → nivel de sal\n✓ Una vez al año → mantenimiento profesional\n✓ Cada 3-5 años → revisión profunda (resinas, válvulas)\n\nSeñal clara de que algo no va bien: vuelves a notar cal en los grifos. Eso es siempre un aviso.\n\n¿Cuánto lleva el tuyo sin revisar?",
    copy_short: "Mantenimiento descalcificador: cada 6 meses sal, cada año revisión, cada 3-5 años profunda.",
    cta: "Reserva revisión con técnico de {{brand_name}}",
    hashtags_extra: [
      "#Descalcificador",
      "#MantenimientoPreventivo",
      "#AguaSinCal",
      "#ServicioTecnico",
    ],
    image_prompt:
      "Infografía cuadrada 1080x1080. 3 calendarios estilizados en línea horizontal indicando intervalos: 6m, 12m, 3-5años. Cada uno con etiqueta corta. Paleta azul gradiente sobre blanco. Encabezado superior 'Mantenimiento del descalcificador'. Estilo flat editorial técnico. Sin logos.",
    image_alt: "Infografía con tres bloques temporales para mantenimiento de descalcificador: 6 meses, 1 año, 3-5 años.",
    image_format: "1080x1080",
    intent_level: "high",
  },
  {
    id: "edu-plastico-vs-osmosis",
    content_type: "educational",
    channels: ["instagram", "facebook"],
    target_segment: "hogar",
    topic: "Cuánto plástico evitas con ósmosis en casa",
    copy_main:
      "Una familia de 4 personas que cambia agua embotellada por agua filtrada en casa puede dejar de comprar más de 1.000 botellas al año 🌍\n\nNo es solo plástico evitado: es menos transporte, menos peso que cargar a casa, menos almacenaje.\n\n¿Sabes cuánto plástico generas tú al año? Hazte la cuenta 👇",
    copy_short: "1 familia ≈ 1.000 botellas/año evitadas al cambiar a ósmosis.",
    cta: "Calcula tu ahorro estimado →",
    hashtags_extra: [
      "#SinPlastico",
      "#OsmosisInversa",
      "#AhorroDeAgua",
      "#SostenibilidadEnCasa",
      "#ReducirPlastico",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. A la izquierda jarra de cristal con agua cristalina. A la derecha pila simbólica de botellas plásticas genéricas apiladas (sin marca visible). Flecha entre ambos indicando cambio. Fondo blanco a azul claro gradiente. Texto inferior pequeño '1 familia · 1.000 botellas/año'. Paleta azul + blanco + verde. Sin logos, sin marcas, sin personas.",
    image_alt: "Jarra de cristal con agua junto a una pila de botellas de plástico, ilustrando el cambio a agua filtrada.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  {
    id: "edu-mitos-agua-embotellada",
    content_type: "educational",
    channels: ["instagram", "facebook"],
    target_segment: "general",
    topic: "3 mitos sobre el agua embotellada",
    copy_main:
      "3 mitos sobre el agua embotellada que conviene desmontar:\n\n❌ 'Es más pura que la del grifo' — En la mayoría de zonas con red moderna, no necesariamente. Y al embotellar, transportar y almacenar pasan cosas.\n\n❌ 'Es más segura' — El agua de red en España cumple normativa estricta. El problema doméstico suele ser la dureza, no la potabilidad.\n\n❌ 'No hay alternativa' — Filtración o ósmosis dan agua de calidad sin botellas.\n\nLa decisión depende de tu zona y tus necesidades — pero conviene tomarla con datos.",
    copy_short: "3 mitos del agua embotellada: pureza, seguridad y 'no hay alternativa'.",
    cta: "Pide un análisis técnico del agua de tu zona 🔍",
    hashtags_extra: [
      "#AguaEmbotellada",
      "#AguaPotable",
      "#CalidadDelAgua",
      "#Mitos",
      "#SinPlastico",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080 estilo editorial. Botella genérica de plástico azul cruzada con un símbolo X grande sutil sobre fondo azul claro degradado. Tres etiquetas pequeñas alrededor con texto: 'Pureza', 'Seguridad', 'Alternativa'. Paleta azul + blanco. Estilo limpio profesional. Sin marcas, sin logos.",
    image_alt: "Botella de plástico con símbolo de prohibido y tres etiquetas: pureza, seguridad, alternativa.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  {
    id: "edu-dureza-explicada",
    content_type: "educational",
    channels: ["instagram", "facebook"],
    target_segment: "general",
    topic: "Qué es la dureza del agua (y por qué importa)",
    copy_main:
      "La dureza del agua mide cuánto calcio y magnesio contiene. Se expresa en °fH (grados franceses) o ppm:\n\n💧 0-15 °fH → agua blanda\n💧 15-30 °fH → agua media\n💧 30-50 °fH → agua dura\n💧 +50 °fH → muy dura\n\nLa mayoría de España vive entre dureza media y dura.\n\n¿Por qué importa?\n· Por encima de 25 °fH, los electrodomésticos sufren\n· Las tuberías se incrustan\n· El calentador consume más\n· La cal mancha grifería y mampara\n\nSaber tu dureza es el primer paso para decidir si necesitas descalcificador.",
    copy_short: "Dureza del agua: cuánto calcio y magnesio tiene. Por encima de 25 °fH, electrodomésticos sufren.",
    cta: "Medimos la dureza de tu agua sin compromiso →",
    hashtags_extra: [
      "#DurezaDelAgua",
      "#AguaSinCal",
      "#Descalcificador",
      "#CalidadDelAgua",
    ],
    image_prompt:
      "Infografía cuadrada 1080x1080. Escala horizontal de gradiente azul claro a azul oscuro con 4 segmentos: Blanda / Media / Dura / Muy dura, con valores °fH bajo cada uno. Encabezado 'Dureza del agua'. Estilo flat editorial técnico. Paleta azul + blanco. Sin logos.",
    image_alt: "Escala visual de la dureza del agua del 0 a más de 50 grados franceses, con cuatro categorías.",
    image_format: "1080x1080",
    intent_level: "low",
  },
  {
    id: "edu-reutilizar-agua",
    content_type: "educational",
    channels: ["instagram", "facebook"],
    target_segment: "general",
    topic: "5 formas fáciles de reutilizar agua en casa",
    copy_main:
      "Ahorrar agua no siempre es caro. 5 cambios que NO cuestan nada:\n\n1️⃣ El agua de cocer verdura → riega tus plantas (cuando se enfríe).\n2️⃣ La que cae mientras esperas que salga caliente → cúbeta para limpiar o regar.\n3️⃣ El último enjuagado del friegaplatos → puede ir al cubo del fregado del suelo.\n4️⃣ Agua de lluvia → recoge en cubos para el patio.\n5️⃣ El agua de descongelar → riego.\n\nNi tecnología, ni inversión. Solo un cambio de hábito.",
    copy_short: "5 formas de reutilizar agua en casa sin gastar un euro.",
    cta: "¿Cuál vas a probar esta semana? Cuéntanos 💬",
    hashtags_extra: [
      "#AhorroDeAgua",
      "#ReutilizarAgua",
      "#Sostenibilidad",
      "#EcoTips",
      "#HogarEcologico",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080 estilo ilustración plana editorial. 5 iconos minimalistas en composición circular: olla, ducha con cubeta, fregadero, cubo de lluvia, planta regada. Fondo verde menta claro. Paleta verde + azul + blanco. Encabezado 'Reutilizar agua en casa'. Estilo flat moderno. Sin logos.",
    image_alt: "Ilustración con cinco iconos sobre formas de reutilizar agua en casa.",
    image_format: "1080x1080",
    intent_level: "low",
  },
];

// =============================================================================
// COMERCIAL SUAVE
// =============================================================================

export const COMMERCIAL_SOFT: ContentTemplate[] = [
  {
    id: "com-amortizacion",
    content_type: "commercial_soft",
    channels: ["instagram", "facebook"],
    target_segment: "hogar",
    topic: "Por qué tu factura baja con buena instalación",
    copy_main:
      "Una buena instalación de tratamiento de agua NO es solo un gasto. Es un ahorro mensual real:\n\n💸 Menos compras de botellas\n💸 Lavavajillas y lavadora duran más\n💸 Menos descalcificadores químicos para mamparas\n💸 Calderas con menos consumo de energía\n💸 Tuberías más limpias\n\nEn muchos hogares la instalación se amortiza sola en 2-3 años.\n\n¿Quieres saber cuánto te ahorrarías?",
    copy_short: "Filtración + descalcificación se amortizan en 2-3 años en la mayoría de hogares.",
    cta: "Calcula tu ahorro estimado en una llamada →",
    hashtags_extra: [
      "#AhorroEnCasa",
      "#OsmosisInversa",
      "#Descalcificador",
      "#FacturaAgua",
      "#FacturaLuz",
    ],
    image_prompt:
      "Composición cuadrada 1080x1080 estilo ilustración limpia. Mitad izquierda con tono rojo claro: pila de botellas y electrodoméstico estilizado. Mitad derecha tono verde claro: jarra de cristal limpia + monedas apiladas. Línea central divisoria con texto 'ANTES / DESPUÉS'. Paleta rojo suave vs verde menta + azul agua. Estilo flat editorial. Sin logos, sin marcas.",
    image_alt: "Comparación visual del antes y después: botellas y gastos frente a agua filtrada y ahorro.",
    image_format: "1080x1080",
    intent_level: "high",
  },
  {
    id: "com-revisar-instalacion",
    content_type: "commercial_soft",
    channels: ["instagram", "facebook"],
    target_segment: "hogar",
    topic: "¿Cuándo conviene revisar tu instalación de agua?",
    copy_main:
      "5 señales de que tu instalación de tratamiento necesita revisión:\n\n🔍 Vuelves a notar cal en grifería y mampara\n🔍 Calentador tarda más en calentar\n🔍 Cambio de sabor o color del agua\n🔍 Presión más baja de lo normal\n🔍 Tu lavavajillas pide más sal de lo habitual\n\nUna revisión a tiempo puede evitar reparaciones caras. Lo ideal: una vez al año aunque no notes nada.",
    copy_short: "5 señales de que tu instalación de agua necesita revisión.",
    cta: "Pide revisión con {{brand_name}} →",
    hashtags_extra: [
      "#MantenimientoPreventivo",
      "#Descalcificador",
      "#ServicioTecnico",
      "#HogarCuidado",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Lupa estilizada sobre una tubería metálica seccionada con agua fluyendo dentro. Paleta azul + plata + blanco. Texto integrado 'Revisa a tiempo'. Estilo editorial técnico, sin logos, sin marcas.",
    image_alt: "Lupa enfocando una tubería con agua, simbolizando la revisión preventiva.",
    image_format: "1080x1080",
    intent_level: "high",
  },
  {
    id: "com-confianza",
    content_type: "commercial_soft",
    channels: ["instagram", "facebook"],
    target_segment: "general",
    topic: "Cómo elegir un instalador de confianza",
    copy_main:
      "Elegir bien al instalador es tan importante como elegir bien el equipo. 4 cosas que conviene comprobar:\n\n✓ Hace análisis del agua ANTES de proponer (no recetas a ciegas)\n✓ Te explica las opciones, no solo te ofrece la más cara\n✓ Da garantía clara por escrito\n✓ Tiene servicio técnico propio para mantenimiento\n\nSi cumple los 4, vas por buen camino.\n\nEn {{brand_name}} hacemos los 4 desde el día uno.",
    copy_short: "4 cosas a comprobar al elegir instalador de tratamiento de agua.",
    cta: "Habla con {{brand_name}} →",
    hashtags_extra: [
      "#TratamientoDelAgua",
      "#Confianza",
      "#ServicioTecnico",
      "#OsmosisInversa",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Lista de checklist con 4 elementos marcados con verde sobre fondo blanco. Encabezado 'Cómo elegir instalador'. Estilo editorial limpio. Paleta blanco + verde + azul agua. Sin logos.",
    image_alt: "Lista de verificación con cuatro criterios para elegir un instalador de tratamiento de agua.",
    image_format: "1080x1080",
    intent_level: "high",
  },
  {
    id: "com-presupuesto-gratis",
    content_type: "commercial_soft",
    channels: ["instagram", "facebook"],
    target_segment: "general",
    topic: "Análisis gratuito del agua de tu zona",
    copy_main:
      "En {{brand_name}} ofrecemos análisis gratuito del agua de tu zona, sin compromiso 💧\n\n¿Qué medimos?\n· Dureza real (no la teórica de tu municipio)\n· Cloro residual\n· Conductividad\n· pH\n· Hierro y otros parámetros si proceden\n\nCon esos datos te decimos qué necesitas (o si no necesitas nada). Sin venta presionada.\n\n¿Lo pedimos?",
    copy_short: "Análisis gratuito del agua sin compromiso — y sin venta presionada.",
    cta: "Reserva tu análisis →",
    hashtags_extra: [
      "#AnalisisDelAgua",
      "#CalidadDelAgua",
      "#SinCompromiso",
      "#TratamientoDelAgua",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Tubo de ensayo con agua azul transparente sobre superficie blanca. A su lado, hoja con datos de análisis estilizada. Paleta azul agua + blanco + acentos verde. Estilo editorial profesional. Sin logos, sin marcas.",
    image_alt: "Tubo de ensayo con agua y hoja de análisis simbólica.",
    image_format: "1080x1080",
    intent_level: "high",
  },
  {
    id: "com-ahorro-luz",
    content_type: "commercial_soft",
    channels: ["instagram", "facebook"],
    target_segment: "hogar",
    topic: "Cómo el agua dura sube tu factura de luz",
    copy_main:
      "¿Sabías que la dureza del agua afecta directamente tu factura eléctrica?\n\nEl calentador o termo eléctrico con cal incrustada puede consumir entre un 15% y un 30% MÁS para alcanzar la misma temperatura.\n\nMultiplicado por meses, eso es dinero perdido por algo evitable.\n\nUn descalcificador bien dimensionado protege:\n· Calentador\n· Termo\n· Lavadora\n· Lavavajillas\n· Tuberías\n\nLa amortización suele ser rápida en zonas con dureza media-alta.",
    copy_short: "Cal en calentador = +15-30% de consumo eléctrico. Evitarlo es barato y rápido.",
    cta: "Pide presupuesto sin compromiso →",
    hashtags_extra: [
      "#FacturaLuz",
      "#AhorroEnergetico",
      "#Descalcificador",
      "#EficienciaEnergetica",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Bombilla luminosa con efecto de gota de agua azul cayendo dentro. Fondo gradiente azul claro. Paleta azul + amarillo cálido sutil + blanco. Texto sutil '+15-30% si hay cal'. Estilo editorial técnico. Sin logos.",
    image_alt: "Bombilla con gota de agua, simbolizando la relación entre cal y consumo eléctrico.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  {
    id: "com-empresa-presupuesto",
    content_type: "commercial_soft",
    channels: ["instagram", "facebook", "linkedin"],
    target_segment: "empresa",
    topic: "Auditoría hídrica para empresas",
    copy_main:
      "Si tu empresa consume agua para procesos, refrigeración, hostelería o cualquier uso intensivo, una auditoría puede revelar oportunidades de ahorro importantes.\n\n¿Qué incluye?\n✓ Inventario de puntos de consumo\n✓ Análisis del agua de red\n✓ Detección de fugas y sobreconsumos\n✓ Propuesta técnica con plazos de amortización\n✓ Sin compromiso\n\nEn {{brand_name}} la hacemos transparente. Aunque no acabes contratando, te llevas información útil.",
    copy_short: "Auditoría hídrica empresarial sin compromiso — útil aunque no contrates.",
    copy_linkedin:
      "En {{brand_name}} acompañamos a empresas medianas (hostelería, residencias, talleres, comunidades) en su transición hacia un uso más eficiente del agua. La auditoría inicial es gratuita y entregamos un informe con propuesta técnica + plazo de amortización. Si crees que tu empresa puede beneficiarse, hablemos.",
    cta: "Solicita tu auditoría →",
    hashtags_extra: [
      "#AuditoriaHidrica",
      "#Sostenibilidad",
      "#Empresas",
      "#ESG",
      "#EficienciaHidrica",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Vista de oficina/empresa con grifo industrial moderno + iPad mostrando datos abstractos de consumo. Iluminación natural cálida. Paleta corporate: azul cobalto + blanco + grafito. Estilo profesional editorial. Sin marcas, sin personas reconocibles.",
    image_alt: "Grifo industrial moderno junto a una tablet con datos de consumo de agua.",
    image_format: "1080x1080",
    intent_level: "high",
  },
];

// =============================================================================
// AUTORIDAD TÉCNICA (mejor en LinkedIn)
// =============================================================================

export const TECHNICAL_AUTHORITY: ContentTemplate[] = [
  {
    id: "tech-dureza-electrodomesticos",
    content_type: "technical_authority",
    channels: ["linkedin"],
    target_segment: "empresa",
    topic: "La métrica más infravalorada del mantenimiento doméstico",
    copy_main:
      "La mayoría de instalaciones domésticas no fallan por vejez: fallan por dureza acumulada del agua.\n\nCada grado de dureza adicional (°fH o ppm CaCO₃) acelera la incrustación en intercambiadores, resistencias y válvulas. Un calentador con cal incrustada consume entre un 15% y un 30% más de energía para alcanzar la misma temperatura.\n\nLa inversión en tratamiento (descalcificador + filtración) tiene una de las amortizaciones más predecibles del sector hogar: 2-3 años en zonas de dureza media-alta.\n\nEn {{brand_name}} ayudamos a hogares y empresas a hacer este cálculo de forma honesta antes de proponer nada.",
    copy_short: "Dureza acumulada = +15-30% consumo eléctrico en calentadores. Amortización tratamiento: 2-3 años.",
    cta: "Hablemos sobre tu caso →",
    hashtags_extra: [
      "#TratamientoDelAgua",
      "#EficienciaEnergetica",
      "#MantenimientoPredictivo",
    ],
    image_prompt:
      "Imagen panorámica 1200x627 estilo corporate clean. Sección de tubería metálica seccionada: mitad izquierda con incrustaciones blancas visibles, mitad derecha pulida y limpia. Paleta industrial gris-acero + azul agua. Estilo fotorrealista editorial. Sin marcas.",
    image_alt: "Sección de tubería con incrustaciones de cal a la izquierda y limpia a la derecha.",
    image_format: "1200x627",
    intent_level: "medium",
  },
  {
    id: "tech-caso-comunidad",
    content_type: "technical_authority",
    channels: ["linkedin"],
    target_segment: "comunidad",
    topic: "Caso técnico — reducción 38% consumo sal en comunidad",
    copy_main:
      "Caso técnico real (comunidad de vecinos · 45 viviendas).\n\nAntes: descalcificador centralizado consumía ~180 kg sal/mes.\nTras revisión: 112 kg sal/mes (-38%).\n\n¿Qué hicimos? No cambiamos el equipo. Solo:\n\n1. Reajustamos el ciclo de regeneración según dureza real medida (no según el preset de fábrica).\n2. Corregimos un fallo de calibración del medidor de caudal.\n3. Optimizamos el horario de regeneración a horas valle.\n\nResultado: -38% sal, -22% agua en regeneración, -15% factura eléctrica del compresor.\n\nCoste de la intervención: 1 visita técnica.\nAhorro anual estimado: ~480 € + reducción CO₂.\n\nLa eficiencia muchas veces no está en comprar equipo nuevo: está en sacar más del que ya tienes.",
    copy_short: "Caso real: -38% sal en descalcificador de comunidad solo con reajuste técnico.",
    cta: "Si gestionas una comunidad, hablemos.",
    hashtags_extra: [
      "#MantenimientoPredictivo",
      "#EficienciaHidrica",
      "#ComunidadesDeVecinos",
    ],
    image_prompt:
      "Imagen panorámica 1200x627. Gráfico de barras estilizado mostrando dos columnas: 'Antes 180kg' alta + 'Después 112kg' menor, con flecha verde descendente. Paleta corporate azul + verde + blanco. Estilo editorial técnico. Sin marcas.",
    image_alt: "Gráfico comparativo de consumo de sal antes y después: de 180 kg a 112 kg al mes.",
    image_format: "1200x627",
    intent_level: "medium",
  },
  {
    id: "tech-estres-hidrico-esp",
    content_type: "technical_authority",
    channels: ["linkedin"],
    target_segment: "empresa",
    topic: "Estrés hídrico en España — implicaciones empresariales",
    copy_main:
      "España está entre los países europeos con mayor estrés hídrico proyectado a 10 años (informes EEA + AEMET).\n\nPara las empresas eso significa, en orden creciente:\n\n1. Subida del precio del agua industrial.\n2. Restricciones puntuales en zonas con sequía prolongada.\n3. Presión normativa sobre eficiencia.\n4. Compras públicas que ya empiezan a pedir KPIs hídricos.\n\nLas soluciones técnicas existen: reutilización de aguas grises, recuperación de aguas de proceso, desmineralización eficiente, monitorización en tiempo real…\n\nNo es 'vendrá'. Está pasando.\n\nEn {{brand_name}} acompañamos a empresas en este recorrido.",
    copy_short: "Estrés hídrico España: 4 impactos para empresas y palancas técnicas para responder.",
    cta: "Hablemos sobre tu caso →",
    hashtags_extra: [
      "#EstresHidrico",
      "#Sostenibilidad",
      "#ESG",
      "#GestionDelAgua",
    ],
    image_prompt:
      "Imagen panorámica 1200x627 estilo corporate. Mapa de España estilizado en degradado de azul oscuro a ocre seco, indicando áreas con estrés hídrico. Paleta tierra + azul + blanco. Estilo editorial premium. Sin logos.",
    image_alt: "Mapa estilizado de España con gradiente de azul a tierra mostrando estrés hídrico.",
    image_format: "1200x627",
    intent_level: "low",
  },
  {
    id: "tech-osmosis-bajo-desperdicio",
    content_type: "technical_authority",
    channels: ["linkedin"],
    target_segment: "general",
    topic: "Ósmosis de bajo desperdicio: la nueva generación",
    copy_main:
      "Históricamente, la ósmosis inversa doméstica desperdiciaba ratios de 1:3 a 1:4 (por cada litro de agua osmotizada, 3-4 al desagüe).\n\nLas últimas generaciones (membranas tight + bombas booster + recovery) bajan ese ratio a 1:1 e incluso 2:1 (más agua producida que desperdiciada).\n\nDiferencias prácticas:\n· Mismo equipo de cocina, mucha menos agua al desagüe\n· Ideal en zonas con sequía o factura de agua alta\n· Algo más caras inicialmente, pero amortización rápida\n\nSi tu instalación tiene +8 años, conviene revisar el ratio.",
    copy_short: "Ósmosis moderna baja el desperdicio de 1:4 a 1:1. Vale la pena revisar si tu equipo es antiguo.",
    cta: "Te asesoramos sobre tu equipo →",
    hashtags_extra: [
      "#OsmosisInversa",
      "#EficienciaHidrica",
      "#TecnologiaDelAgua",
      "#Sostenibilidad",
    ],
    image_prompt:
      "Imagen panorámica 1200x627. Esquema técnico de un equipo de ósmosis moderno con flechas indicando flujos de agua entrante, producto y desagüe. Etiquetas mostrando ratio 1:1. Paleta azul + blanco + acentos verdes. Estilo técnico editorial.",
    image_alt: "Esquema técnico de equipo de ósmosis inversa de bajo desperdicio con ratio 1 a 1.",
    image_format: "1200x627",
    intent_level: "medium",
  },
  {
    id: "tech-fugas-deteccion",
    content_type: "technical_authority",
    channels: ["linkedin"],
    target_segment: "comunidad",
    topic: "Cómo detectar fugas en comunidades de vecinos",
    copy_main:
      "Una fuga oculta en una comunidad puede costar miles de litros al mes sin que nadie se dé cuenta. Cómo detectarlas:\n\n🔧 Lectura del contador general en horario nocturno (3-5am): si avanza, hay consumo no humano = fuga.\n🔧 Comparación mensual del consumo total con suma de contadores individuales.\n🔧 Termografía si se sospecha de tuberías en muros.\n🔧 Caudalímetro digital en arqueta para registrar caudal continuo.\n\nUna fuga del 10% en una comunidad de 50 viviendas son fácilmente 500-1.000 m³/año perdidos. Es ahorro real y palpable.\n\nSi gestionas una comunidad, vale la pena empezar por la lectura nocturna.",
    copy_short: "Detección de fugas en comunidades: lectura nocturna del contador + comparación mensual.",
    cta: "Te ayudamos con auditoría hídrica →",
    hashtags_extra: [
      "#ComunidadesDeVecinos",
      "#AdministracionDeFincas",
      "#AhorroDeAgua",
      "#GestionDelAgua",
    ],
    image_prompt:
      "Imagen panorámica 1200x627 estilo técnico. Contador de agua digital con número parpadeando rojo. Fondo de habitación de instalaciones con tuberías. Paleta industrial gris-azul. Estilo editorial.",
    image_alt: "Contador de agua digital con cifras destacadas, en sala de instalaciones.",
    image_format: "1200x627",
    intent_level: "high",
  },
  {
    id: "tech-cafe-hosteleria",
    content_type: "technical_authority",
    channels: ["linkedin"],
    target_segment: "hosteleria",
    topic: "El agua del café: cómo afecta a tu negocio hostelero",
    copy_main:
      "Un dato que muchos hosteleros desconocen: la calidad del agua influye en el café más que la propia máquina o el grano.\n\n✓ Dureza ideal: 50-100 ppm CaCO₃ (media-baja)\n✓ pH cercano a 7\n✓ Sin cloro residual (modifica aroma)\n✓ Conductividad estable (sabor consistente)\n\nUna máquina de calidad con agua de mala calidad da café irregular. Y el cliente lo nota a la quinta visita.\n\nSoluciones técnicas habituales para barras: filtro de carbón + descalcificador parcial. Más sofisticado: ósmosis con remineralización controlada para zonas duras.\n\nNo es coquetería: es tu producto.",
    copy_short: "Calidad del agua = calidad del café. Parámetros técnicos clave para hostelería.",
    cta: "Análisis técnico para hostelería →",
    hashtags_extra: [
      "#Hosteleria",
      "#Cafe",
      "#CalidadDelAgua",
      "#Restaurantes",
      "#Bares",
    ],
    image_prompt:
      "Imagen panorámica 1200x627. Taza profesional de café con espuma cremosa perfecta sobre barra moderna desenfocada. Luz natural cálida estilo café shop. Paleta cálida con detalles azules sutiles. Sin marcas, sin personas.",
    image_alt: "Taza de café con espuma cremosa sobre barra moderna, sugiriendo calidad de agua para hostelería.",
    image_format: "1200x627",
    intent_level: "high",
  },
];

// =============================================================================
// LOCAL / CERCANÍA (por segmento)
// =============================================================================

export const LOCAL: ContentTemplate[] = [
  {
    id: "loc-hosteleria-agua",
    content_type: "local",
    channels: ["instagram", "facebook"],
    target_segment: "hosteleria",
    topic: "El agua condiciona todo lo que sirve tu bar o restaurante",
    copy_main:
      "Si tienes bar, restaurante o cafetería, sabes que el agua condiciona TODO lo que servís:\n\n☕ El café sabe distinto según el agua\n🍺 La cerveza pierde matices con agua dura\n🥘 La pasta y el arroz absorben sabor\n🍷 Los vasos salen con manchas si hay cal\n🍽 La lavavajillas se rompe antes\n\nY el cliente lo nota.\n\nEn {{brand_name}} hacemos análisis específicos para hostelería: medimos la dureza real, evaluamos qué tecnología necesitas y te decimos el coste real de NO tratarla.",
    copy_short: "Hostelería: el agua condiciona café, cerveza, arroz, vasos y vida útil de la lavavajillas.",
    cta: "Análisis técnico hostelería sin compromiso →",
    hashtags_extra: [
      "#Hosteleria",
      "#CalidadDelAgua",
      "#Bares",
      "#Restaurantes",
      "#Cafeterias",
    ],
    image_prompt:
      "Foto editorial cuadrada 1080x1080. Barra de cafetería moderna con taza de café con espuma + vaso de cristal limpio + jarra de agua. Iluminación cálida hora dorada. Sin marcas, sin personas. Paleta cálida con acentos azules. Composición editorial premium.",
    image_alt: "Barra de cafetería con café, vaso de cristal y jarra de agua, sugiriendo la importancia del agua en hostelería.",
    image_format: "1080x1080",
    intent_level: "high",
  },
  {
    id: "loc-comunidades",
    content_type: "local",
    channels: ["instagram", "facebook"],
    target_segment: "comunidad",
    topic: "Tratamiento de agua centralizado en comunidades",
    copy_main:
      "Las comunidades de vecinos suelen tener una decisión pendiente: ¿tratamos el agua a nivel de edificio o lo dejamos a cada vecino?\n\nVentajas del tratamiento centralizado:\n✓ Coste por vivienda menor (escala)\n✓ Protege la instalación general\n✓ Reduce reclamaciones individuales\n✓ Mantenimiento centralizado más sencillo\n\nContras:\n· Inversión inicial conjunta (acuerdo en junta)\n· Necesita instalador con experiencia\n\nEn {{brand_name}} trabajamos con administradores de fincas para proponer soluciones con presupuesto claro y mantenimiento acordado.",
    copy_short: "Tratamiento centralizado en comunidades: pros, contras y cómo decidir.",
    cta: "Solicitud técnica para comunidades →",
    hashtags_extra: [
      "#ComunidadesDeVecinos",
      "#AdministracionDeFincas",
      "#TratamientoDelAgua",
      "#Edificios",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Fachada moderna de edificio residencial visto desde abajo + simbología técnica de instalación de agua estilizada sobreimpresa. Cielo azul claro. Paleta neutra con azul agua de acento. Estilo editorial arquitectónico. Sin marcas.",
    image_alt: "Fachada de edificio residencial moderno con simbología técnica de instalación de agua.",
    image_format: "1080x1080",
    intent_level: "high",
  },
  {
    id: "loc-familia-cal",
    content_type: "local",
    channels: ["instagram", "facebook"],
    target_segment: "hogar",
    topic: "La cal y los niños — manchas, jabón y piel",
    copy_main:
      "En casas con niños la dureza del agua se nota especialmente:\n\n🛁 Eccemas o picores tras el baño (especialmente bebés)\n🧴 Más cantidad de champú/jabón para conseguir espuma\n👕 La ropa más rígida tras lavar (cal en las fibras)\n🧽 Tareas de limpieza interminables por las manchas\n\nNo es 'cómo es el agua y ya'. Hay solución técnica.\n\nUn descalcificador adecuado mejora la convivencia diaria y reduce el coste de productos de limpieza y aseo.",
    copy_short: "La cal afecta a los niños: eccemas, ropa rígida, jabón que no espuma. Tiene solución.",
    cta: "Pide análisis del agua de tu casa →",
    hashtags_extra: [
      "#Familia",
      "#CalEnCasa",
      "#Descalcificador",
      "#PielSana",
      "#Maternidad",
    ],
    image_prompt:
      "Foto editorial cuadrada 1080x1080. Bañera infantil con burbujas de jabón y patito de goma, luz natural suave por ventana. Sin personas visibles. Paleta pastel blanco + azul muy claro. Estilo cálido familiar. Sin marcas.",
    image_alt: "Bañera infantil con burbujas y patito de goma con luz natural suave.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  {
    id: "loc-administradores",
    content_type: "local",
    channels: ["instagram", "facebook", "linkedin"],
    target_segment: "administradores",
    topic: "Para administradores de fincas — propuesta técnica clara",
    copy_main:
      "Para administradores de fincas: gestionar una comunidad con problemas de cal en la red general es un agotamiento.\n\nLo que necesitas: una propuesta técnica clara para llevar a junta. No solo un presupuesto.\n\nEn {{brand_name}} preparamos paquetes específicos para comunidades:\n✓ Análisis del agua de red\n✓ Propuesta técnica con presupuesto desglosado\n✓ Cálculo de amortización por vivienda\n✓ Plan de mantenimiento anual incluido\n✓ Documentación lista para presentar en junta\n\nSi gestionas comunidades con problemas de cal, hablemos.",
    copy_short: "Para administradores de fincas: propuestas técnicas listas para junta de vecinos.",
    copy_linkedin:
      "Trabajo regular con administradores de fincas: les facilitamos toda la documentación técnica y económica para llevar a junta. Hablamos su lenguaje y entendemos los tiempos del proceso. Si gestionas comunidades, conecta y hablemos.",
    cta: "Conecta con {{brand_name}} →",
    hashtags_extra: [
      "#AdministracionDeFincas",
      "#ComunidadesDeVecinos",
      "#GestionDeFincas",
      "#TratamientoDelAgua",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Carpeta abierta con planos arquitectónicos + tablet con datos + bolígrafo. Estilo escritorio profesional. Paleta neutra blanco + gris + azul. Sin marcas.",
    image_alt: "Escritorio con carpeta, planos arquitectónicos y tablet, simbolizando documentación técnica.",
    image_format: "1080x1080",
    intent_level: "high",
  },
];

// =============================================================================
// EFEMÉRIDES — plantillas por slug
// Cada efeméride puede tener varias fases (1=antes, 2=día oficial, 3=acción posterior).
// =============================================================================

export const EPHEMERIS_TEMPLATES: ContentTemplate[] = [
  // Día Mundial del Agua (22/03)
  {
    id: "eph-dia-agua-2",
    content_type: "ephemeris",
    channels: ["instagram", "facebook"],
    ephemeris_slug: "dia-mundial-del-agua",
    campaign_phase: 2,
    target_segment: "general",
    topic: "Día Mundial del Agua",
    copy_main:
      "💧 Hoy es el Día Mundial del Agua.\n\nUn recurso esencial al que muchas veces no damos importancia hasta que falta. En {{brand_name}} llevamos años ayudando a hogares y empresas a usar mejor el agua que tienen.\n\nNo se trata de tener más. Se trata de usar mejor la que ya tenemos.\n\nFeliz Día Mundial del Agua.",
    cta: "Aprende cómo cuidar el agua de tu casa →",
    hashtags_extra: [
      "#DiaMundialDelAgua",
      "#WorldWaterDay",
      "#Agua",
      "#Sostenibilidad",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Gota de agua grande central con reflejo del mundo dentro, fondo azul cielo. Texto integrado superior '22/03 · Día Mundial del Agua'. Paleta azul + blanco + acento verde. Estilo editorial premium. Sin logos ONU.",
    image_alt: "Gota de agua con reflejo del mundo y texto del Día Mundial del Agua.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  // Día Medio Ambiente (05/06)
  {
    id: "eph-medio-ambiente-1",
    content_type: "ephemeris",
    channels: ["instagram", "facebook"],
    ephemeris_slug: "dia-mundial-medio-ambiente",
    campaign_phase: 1,
    target_segment: "general",
    topic: "Anticipación Día Mundial del Medio Ambiente",
    copy_main:
      "El 5 de junio es el Día Mundial del Medio Ambiente 🌱\n\nLa mejor forma de celebrarlo no es publicar una foto: es revisar qué hábitos diarios podemos cambiar.\n\n3 cambios que reducen tu huella hídrica en casa:\n🟦 Filtrar agua en grifo en vez de comprar botellas\n🟦 Revisar y mantener tu descalcificador\n🟦 Reutilizar el agua de cocción para regar plantas\n\nCada gesto cuenta. Y suma.",
    cta: "Cuéntanos qué cambio harás esta semana 💬",
    hashtags_extra: [
      "#DiaMundialDelMedioAmbiente",
      "#WorldEnvironmentDay",
      "#HuellaHidrica",
      "#Sostenibilidad",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Fondo de hojas verdes desenfocadas (bokeh). Círculo blanco central con texto '5 JUNIO · Día Mundial del Medio Ambiente'. Pequeña gota azul al lado. Paleta verde + azul + blanco. Estilo limpio profesional. Sin logos oficiales.",
    image_alt: "Hojas verdes desenfocadas con texto destacado: 5 de junio Día Mundial del Medio Ambiente.",
    image_format: "1080x1080",
    intent_level: "low",
  },
  {
    id: "eph-medio-ambiente-2",
    content_type: "ephemeris",
    channels: ["instagram", "facebook"],
    ephemeris_slug: "dia-mundial-medio-ambiente",
    campaign_phase: 2,
    target_segment: "general",
    topic: "Día Mundial del Medio Ambiente",
    copy_main:
      "🌍 Hoy es el Día Mundial del Medio Ambiente.\n\nEn {{brand_name}} creemos que cuidar el planeta empieza por algo tan cotidiano como el agua que bebemos.\n\nUna instalación de tratamiento bien hecha NO es solo comodidad: es menos plástico en océanos, menos transporte, menos residuos y agua de calidad cada día sin pensar en ello.\n\nNuestro compromiso:\n✓ Equipos eficientes y duraderos\n✓ Mantenimiento que alarga la vida de la instalación\n✓ Asesoramiento honesto: si no necesitas, te lo decimos\n\nHoy y los 364 días restantes.",
    cta: "Pide tu análisis gratuito del agua de tu zona ↗",
    hashtags_extra: [
      "#DiaMundialDelMedioAmbiente",
      "#WorldEnvironmentDay",
      "#MedioAmbiente",
      "#TratamientoDelAgua",
      "#Sostenibilidad",
    ],
    image_prompt:
      "Composición cuadrada 1080x1080 editorial. 3 elementos verticales: globo terráqueo lineal, gota de agua central, hojas verdes con rocío. Texto '5/06 · Día Mundial del Medio Ambiente'. Paleta azul + verde + tierra cálida + blanco. Sin logos.",
    image_alt: "Composición visual con globo terráqueo, gota de agua y hojas con rocío para el Día Mundial del Medio Ambiente.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  // Día Océanos (08/06)
  {
    id: "eph-oceanos-2",
    content_type: "ephemeris",
    channels: ["instagram", "facebook"],
    ephemeris_slug: "dia-mundial-de-los-oceanos",
    campaign_phase: 2,
    target_segment: "general",
    topic: "Día Mundial de los Océanos",
    copy_main:
      "🌊 Hoy celebramos el Día Mundial de los Océanos.\n\nCada minuto el equivalente a un camión de basura de plástico llega al mar. Una parte importante es de botellas de un solo uso.\n\nCambiar a agua filtrada en casa no salva el océano por sí solo. Pero es una pieza que sí depende de ti.\n\nHoy es buen día para empezar.",
    cta: "Habla con {{brand_name}} sobre la mejor opción para tu casa →",
    hashtags_extra: [
      "#DiaMundialDeLosOceanos",
      "#WorldOceansDay",
      "#Oceanos",
      "#SinPlastico",
      "#PlasticoEnElMar",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080 estilo fotografía editorial. Superficie del mar azul profundo con olas suaves al amanecer. Sin barcos ni basura visible. Texto integrado superior izquierda '8/06 · Día de los Océanos'. Paleta turquesa + azul cobalto + blanco. Sin logos.",
    image_alt: "Superficie del mar al amanecer con texto del Día Mundial de los Océanos.",
    image_format: "1080x1080",
    intent_level: "low",
  },
  // Día Sequía (17/06)
  {
    id: "eph-sequia-1",
    content_type: "ephemeris",
    channels: ["instagram", "facebook"],
    ephemeris_slug: "dia-lucha-desertificacion-sequia",
    campaign_phase: 1,
    target_segment: "general",
    topic: "Anticipación Día contra la Sequía",
    copy_main:
      "Mañana, 17 de junio, es el Día Mundial de Lucha contra la Desertificación y la Sequía 🌵\n\nEspaña vivirá con más estrés hídrico en los próximos años: ciclos de sequía más largos, más intensos, más frecuentes.\n\nFrente a eso solo hay un camino: usar mejor el agua que tenemos.\n\nEn casa:\n· No tirar agua que se puede reutilizar\n· Filtrar/descalcificar para que las instalaciones duren más\n· Equipos de bajo consumo y mantenimiento al día\n\nVale tanto para una vivienda como para un restaurante o una comunidad.",
    cta: "¿Cómo ahorras agua tú? Cuéntanos 💬",
    hashtags_extra: [
      "#Sequía",
      "#DiaContraLaSequia",
      "#DesertificationDay",
      "#AhorroDeAgua",
      "#EstresHidrico",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Tierra agrietada por la sequía en primer plano transicionando a cielo azul con gota de agua simbólica arriba. Paleta ocre + beige + azul claro. Texto 'Mañana 17/06 · Día contra la Sequía'. Estilo documental no alarmista. Sin logos.",
    image_alt: "Tierra agrietada con cielo azul y gota de agua, anunciando el Día contra la Desertificación y la Sequía.",
    image_format: "1080x1080",
    intent_level: "low",
  },
  {
    id: "eph-sequia-2",
    content_type: "ephemeris",
    channels: ["instagram", "facebook"],
    ephemeris_slug: "dia-lucha-desertificacion-sequia",
    campaign_phase: 2,
    target_segment: "general",
    topic: "Día Mundial contra la Sequía",
    copy_main:
      "17 de junio · Día Mundial de Lucha contra la Desertificación y la Sequía 🌍\n\nEspaña es uno de los países europeos más expuestos a la sequía. La palabra clave no es 'más agua': es 'mejor agua'.\n\nMejor agua significa:\n✓ Aprovechar la que entra en casa al máximo\n✓ Tratar la dureza para evitar reemplazos prematuros\n✓ Filtrar/osmotizar para no depender del agua embotellada\n✓ Reparar fugas y mantener instalaciones\n\nCada metro cúbico que NO se desperdicia es agua disponible mañana.\n\nEn {{brand_name}} damos soluciones técnicas reales, no vendemos miedo.",
    cta: "Análisis gratuito del agua de tu zona →",
    hashtags_extra: [
      "#Sequía",
      "#DiaContraLaSequia",
      "#DesertificationDay",
      "#UsoEficiente",
      "#AhorroDeAgua",
    ],
    image_prompt:
      "Imagen cuadrada 1080x1080. Composición diagonal: arriba tierra agrietada ocre, abajo agua azul brillante. Diagonal con dibujo lineal estilizado de tuberías. Texto '17/06 · Lucha contra la Sequía' centrado. Paleta ocre + azul + blanco. Sin logos oficiales.",
    image_alt: "Composición con tierra agrietada y agua azul separadas por línea diagonal con tuberías.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
  {
    id: "eph-sequia-3",
    content_type: "ephemeris",
    channels: ["instagram", "facebook"],
    ephemeris_slug: "dia-lucha-desertificacion-sequia",
    campaign_phase: 3,
    target_segment: "general",
    topic: "Acciones prácticas tras el Día de la Sequía",
    copy_main:
      "Las acciones cuentan más que las palabras. 3 cosas concretas que puedes hacer esta semana:\n\n1️⃣ Comprueba si tienes fugas: cierra todos los grifos y mira el contador 10 minutos. Si avanza, hay fuga.\n\n2️⃣ Si tienes descalcificador, revisa cuándo fue su última regeneración. Bien ajustado, gasta hasta un 40% menos sal y agua.\n\n3️⃣ Sustituye agua embotellada por agua filtrada de casa. Menos plástico, menos transporte, menos huella.\n\n¿Cuál harás esta semana? 💧",
    cta: "Revisamos tu instalación sin compromiso →",
    hashtags_extra: [
      "#AhorroDeAgua",
      "#Sequía",
      "#UsoEficiente",
      "#Tips",
      "#Descalcificador",
    ],
    image_prompt:
      "Infografía cuadrada 1080x1080. Lista numerada visual de 3 acciones, cada una con icono minimalista: gota con flecha (fugas), símbolo recycle (mantenimiento), jarra de cristal (menos botellas). Paleta blanco + azul gradiente. Encabezado '3 ACCIONES'. Estilo flat editorial. Sin logos.",
    image_alt: "Infografía con tres acciones para ahorrar agua: fugas, mantenimiento, agua filtrada.",
    image_format: "1080x1080",
    intent_level: "medium",
  },
];

export const ALL_TEMPLATES: ContentTemplate[] = [
  ...EDUCATIONAL,
  ...COMMERCIAL_SOFT,
  ...TECHNICAL_AUTHORITY,
  ...LOCAL,
  ...EPHEMERIS_TEMPLATES,
];

/**
 * Sustituye placeholders en una plantilla con datos reales de la empresa.
 */
export function applyVariables(
  text: string,
  vars: {
    brand_name?: string | null;
    brand_hashtag?: string | null;
    ephemeris_name?: string | null;
    ephemeris_date?: string | null;
  },
): string {
  return text
    .replaceAll("{{brand_name}}", vars.brand_name || "tu equipo")
    .replaceAll("{{brand_hashtag}}", vars.brand_hashtag || "")
    .replaceAll("{{ephemeris_name}}", vars.ephemeris_name || "")
    .replaceAll("{{ephemeris_date}}", vars.ephemeris_date || "");
}
