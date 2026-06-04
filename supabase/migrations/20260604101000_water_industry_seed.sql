-- =============================================================================
-- 20260604101000_water_industry_seed.sql
-- Fase 1 del Plan Productos v2.
-- Seed del catálogo SUGERIDO del sector tratamiento de agua:
--   - Categorías globales (jerárquicas)
--   - Atributos globales con unidad de medida
--   - Vínculo N:N de atributos a categorías
--
-- Filosofía: superadmin SUGIERE. Empresa clona y edita libremente.
-- IDEMPOTENTE: cada bloque usa `where not exists` o `on conflict do nothing`.
-- =============================================================================

-- =============================================================================
-- 1) CATEGORÍAS — ósmosis (padre + 3 subcategorías), descalcificadores,
--    dispensadores, horeca, ozono, filtros, servicio.
-- =============================================================================

insert into public.product_categories_global (key, parent_key, name_es, description_es, default_kind, icon, sort_order, is_active)
values
  -- Ósmosis (padre)
  ('osmosis',                     null,        'Ósmosis inversa',                    'Equipos de ósmosis inversa para producción de agua de consumo.',           'equipment',  'droplet',     10, true),
  ('osmosis_5_stages',            'osmosis',   'Ósmosis 5 etapas',                   'Ósmosis tradicional con depósito de acumulación, 5 etapas de filtración.',  'equipment',  'droplet',     11, true),
  ('osmosis_compact',             'osmosis',   'Ósmosis compacta',                   'Ósmosis con depósito integrado o reducido para espacios pequeños.',         'equipment',  'droplet',     12, true),
  ('osmosis_direct_flow',         'osmosis',   'Ósmosis flujo directo',              'Ósmosis sin depósito: producción instantánea con bomba booster.',           'equipment',  'droplet',     13, true),

  -- Descalcificadores
  ('softeners',                   null,        'Descalcificadores',                  'Equipos de intercambio iónico para eliminación de dureza (cal).',           'equipment',  'shield',      20, true),

  -- Dispensadores
  ('dispensers',                  null,        'Dispensadores',                      'Dispensadores de agua frío/caliente/ambiente, sobremesa o de pie.',         'equipment',  'cup',         30, true),

  -- Horeca
  ('horeca',                      null,        'Horeca',                             'Equipos específicos para hostelería y restauración (cocina, café, hielo).', 'equipment',  'coffee',      40, true),

  -- Ozono
  ('ozone',                       null,        'Ozono',                              'Generadores de ozono y sistemas de desinfección.',                          'equipment',  'wind',        50, true),

  -- Filtros (cabezales de filtración, NO confundir con los recambios)
  ('filters',                     null,        'Filtros y cabezales',                'Cabezales de filtración, esterilizadores UV, ultrafiltración.',             'equipment',  'filter',      60, true),

  -- Servicio (líneas de presupuesto/factura)
  ('service',                     null,        'Servicio',                           'Líneas de servicio: horas de trabajo, desplazamiento, mantenimientos a cuota plana.', 'service',    'wrench',      70, true)
on conflict (key) do nothing;

-- =============================================================================
-- 2) ATRIBUTOS GLOBALES — con unidad y tipo de dato.
--    `is_critical` se marca true para los datos prestacionales clave del
--    sector (los que una ficha técnica nunca debería dejar en blanco).
-- =============================================================================

insert into public.product_attributes_global (key, name_es, description_es, data_type, unit, enum_values, default_visible, sort_order, is_critical)
values
  -- ===========================================================================
  -- ÓSMOSIS INVERSA (compartidos por las 3 subcategorías + el padre)
  -- ===========================================================================
  ('osmosis_production_lday',           'Producción permeado',                'L/día producidos a 25°C y presión estándar.',                  'number',  'L/día',  null, true, 10,  true),
  ('osmosis_production_gpd',            'Producción permeado (GPD)',          'Galones por día (mercado USA / membranas estándar).',          'number',  'GPD',    null, false, 11, false),
  ('osmosis_tap_flow_lmin',             'Caudal grifo dispensador',           'Caudal en grifo de salida.',                                    'number',  'L/min',  null, true, 20,  true),
  ('osmosis_tds_rejection_pct',         '% Rechazo TDS',                      'Porcentaje de sólidos disueltos eliminados (95-99% típico).',  'number',  '%',      null, true, 30,  true),
  ('osmosis_max_tds_in_ppm',            'TDS máximo entrada',                 'Sólidos disueltos máximos admisibles en entrada.',              'number',  'ppm',    null, true, 40,  false),
  ('osmosis_pressure_min_bar',          'Presión entrada mín',                'Presión mínima de trabajo en entrada.',                         'number',  'bar',    null, true, 50,  true),
  ('osmosis_pressure_max_bar',          'Presión entrada máx',                'Presión máxima admisible en entrada.',                          'number',  'bar',    null, true, 60,  true),
  ('osmosis_temp_min_c',                'Temperatura agua mín',               'Temperatura mínima admisible.',                                 'number',  '°C',     null, true, 70,  false),
  ('osmosis_temp_max_c',                'Temperatura agua máx',               'Temperatura máxima admisible.',                                 'number',  '°C',     null, true, 80,  false),
  ('osmosis_ph_min',                    'pH mín admisible',                   'pH mínimo del agua de entrada.',                                'number',  null,     null, true, 90,  false),
  ('osmosis_ph_max',                    'pH máx admisible',                   'pH máximo del agua de entrada.',                                'number',  null,     null, true, 100, false),
  ('osmosis_free_chlorine_max_ppm',     'Cloro libre máximo',                 'Cloro libre máximo (>0,1 ppm degrada la membrana TFC).',        'number',  'ppm',    null, true, 110, true),
  ('osmosis_stages',                    'Etapas de filtración',               'Número de etapas (típico 3, 4, 5, 6, 7).',                      'number',  null,     null, true, 120, true),
  ('osmosis_membrane_size',             'Tamaño membrana',                    'Estándar (1812, 2012, 50/75/100 GPD).',                         'text',    null,     null, true, 130, false),
  ('osmosis_membrane_type',             'Tipo membrana',                      'TFC poliamida típicamente.',                                    'text',    null,     null, true, 140, false),
  ('osmosis_prefilter_life_months',     'Vida útil prefiltros',               'Periodicidad de cambio.',                                       'number',  'mes',    null, true, 150, false),
  ('osmosis_membrane_life_months',      'Vida útil membrana',                 'Periodicidad de cambio.',                                       'number',  'mes',    null, true, 160, false),
  ('osmosis_postfilter_life_months',    'Vida útil postfiltro',               'Periodicidad de cambio.',                                       'number',  'mes',    null, true, 170, false),
  ('osmosis_recovery_pct',              'Recuperación permeado/total',        '% de agua recuperada (25-75%).',                                'number',  '%',      null, true, 180, false),
  ('osmosis_booster_pump',              'Bomba booster',                      'Lleva bomba de presión.',                                       'boolean', null,     null, true, 190, false),
  ('osmosis_booster_voltage_v',         'Voltaje bomba booster',              'Voltaje de la bomba.',                                          'number',  'V',      null, true, 200, false),
  ('osmosis_booster_power_w',           'Potencia bomba booster',             'Potencia de la bomba.',                                         'number',  'W',      null, true, 210, false),

  -- Específicos de 5 etapas / compacta (tienen depósito)
  ('osmosis_tank_capacity_l',           'Capacidad depósito',                 'Volumen del depósito acumulación.',                             'number',  'L',      null, true, 220, false),
  ('osmosis_tank_air_pressure_psi',     'Presión aire depósito',              'Presión de pre-carga del depósito (7-10 psi típico).',          'number',  null,     null, true, 230, false),

  -- ===========================================================================
  -- DESCALCIFICADORES
  -- ===========================================================================
  ('softener_resin_volume_l',           'Volumen resina',                     'Litros de resina catiónica.',                                   'number',  'L',      null, true, 1010, true),
  ('softener_cycle_capacity_fm3',       'Capacidad ciclo',                    'Capacidad de intercambio (grados franceses × m³).',             'number',  null,     null, true, 1020, true),
  ('softener_nominal_flow_m3h',         'Caudal nominal',                     'Caudal de servicio recomendado.',                               'number',  'm³/h',   null, true, 1030, true),
  ('softener_peak_flow_m3h',            'Caudal punta',                       'Caudal máximo puntual.',                                        'number',  'm³/h',   null, true, 1040, false),
  ('softener_pressure_drop_bar',        'Pérdida carga nominal',              'Pérdida de carga a caudal nominal.',                            'number',  'bar',    null, true, 1050, false),
  ('softener_salt_per_regen_kg',        'Consumo sal por regeneración',       'Sal usada en cada regeneración.',                               'number',  'kg',     null, true, 1060, true),
  ('softener_salt_efficiency_glr',      'Eficiencia sal',                     'Gramos de sal por litro de resina.',                            'number',  null,     null, true, 1070, false),
  ('softener_water_per_regen_l',        'Consumo agua regeneración',          'Agua consumida en cada regeneración.',                          'number',  'L',      null, true, 1080, false),
  ('softener_salt_tank_kg',             'Capacidad depósito sal',             'Sal que cabe en el depósito.',                                  'number',  'kg',     null, true, 1090, false),
  ('softener_working_pressure_min_bar', 'Presión trabajo mín',                 'Presión mínima de servicio.',                                   'number',  'bar',    null, true, 1100, true),
  ('softener_working_pressure_max_bar', 'Presión trabajo máx',                 'Presión máxima de servicio.',                                   'number',  'bar',    null, true, 1110, true),
  ('softener_temp_min_c',               'Temperatura agua mín',               'Temperatura mínima del agua.',                                  'number',  '°C',     null, true, 1120, false),
  ('softener_temp_max_c',               'Temperatura agua máx',               'Temperatura máxima del agua.',                                  'number',  '°C',     null, true, 1130, false),
  ('softener_ambient_temp_max_c',       'Temperatura ambiente máx',           'Ambiente máximo donde puede operar.',                           'number',  '°C',     null, true, 1140, false),
  ('softener_max_hardness_fr',          'Dureza máx entrada',                 'Dureza máxima admisible.',                                      'number',  '°f',     null, true, 1150, true),
  ('softener_voltage_v',                'Tensión alimentación',               'Voltaje de la electrónica.',                                    'number',  'V',      null, true, 1160, false),
  ('softener_power_w',                  'Consumo eléctrico',                  'Consumo eléctrico de la válvula.',                              'number',  'W',      null, true, 1170, false),
  ('softener_valve_brand_model',        'Cabezal/válvula',                    'Marca y modelo del cabezal (Clack WS1, Fleck 5600 SXT...).',    'text',    null,     null, true, 1180, false),
  ('softener_regen_type',               'Tipo regeneración',                  'Volumétrica / cronométrica / estadística / contracorriente.',  'enum',    null, '{"volumétrica","cronométrica","volumétrica estadística","contracorriente"}', true, 1190, false),
  ('softener_config',                   'Configuración',                      'Monobotella / biblock / cabina compacta / dúplex.',             'enum',    null, '{"monobotella","biblock","cabina compacta","dúplex"}', true, 1200, false),
  ('softener_tank_material',            'Material botella',                   'Habitualmente PRFV (poliéster reforzado fibra de vidrio).',     'text',    null,     null, true, 1210, false),
  ('softener_bypass_integrated',        'By-pass integrado',                  'Lleva by-pass de fábrica.',                                     'boolean', null,     null, true, 1220, false),
  ('softener_wifi_app',                 'Conectividad WiFi/App',              'Conexión a app móvil.',                                         'boolean', null,     null, true, 1230, false),
  ('softener_inlet_outlet_inches',      'Conexión entrada/salida',            'Diámetro de conexión.',                                         'text',    null,     null, true, 1240, false),

  -- ===========================================================================
  -- DISPENSADORES
  -- ===========================================================================
  ('dispenser_cold_temp_c',             'Temperatura frío',                   'Temperatura de servicio agua fría.',                            'number',  '°C',     null, true, 2010, true),
  ('dispenser_hot_temp_c',              'Temperatura caliente',               'Temperatura de servicio agua caliente.',                        'number',  '°C',     null, true, 2020, true),
  ('dispenser_cold_prod_lh',            'Producción agua fría',               'Litros por hora de agua fría.',                                 'number',  'L/h',    null, true, 2030, true),
  ('dispenser_hot_prod_lh',             'Producción agua caliente',           'Litros por hora de agua caliente.',                             'number',  'L/h',    null, true, 2040, true),
  ('dispenser_cold_tank_l',             'Capacidad depósito frío',            'Depósito de agua fría.',                                        'number',  'L',      null, true, 2050, false),
  ('dispenser_hot_tank_l',              'Capacidad depósito caliente',        'Depósito de agua caliente.',                                    'number',  'L',      null, true, 2060, false),
  ('dispenser_cooling_power_w',         'Potencia refrigeración',             'Potencia del sistema de frío.',                                 'number',  'W',      null, true, 2070, false),
  ('dispenser_heating_power_w',         'Potencia calefacción',               'Potencia del sistema de calentamiento.',                        'number',  'W',      null, true, 2080, false),
  ('dispenser_refrigerant',             'Refrigerante',                       'Tipo de refrigerante.',                                         'enum',    null, '{"R134a","R600a","R290"}', true, 2090, false),
  ('dispenser_refrigerant_charge_g',    'Carga refrigerante',                 'Gramos de refrigerante.',                                       'number',  'g',      null, true, 2100, false),
  ('dispenser_voltage_v',               'Voltaje',                            'Voltaje de alimentación.',                                      'number',  'V',      null, true, 2110, false),
  ('dispenser_frequency_hz',            'Frecuencia',                         'Frecuencia eléctrica.',                                         'number',  'Hz',     null, true, 2120, false),
  ('dispenser_power_total_w',           'Consumo eléctrico total',            'Consumo eléctrico nominal.',                                    'number',  'W',      null, true, 2130, false),
  ('dispenser_supply_system',           'Sistema de carga',                   'Garrafón superior / inferior / red / POU.',                     'enum',    null, '{"garrafón superior","garrafón inferior","red","POU"}', true, 2140, true),
  ('dispenser_filters_included',        'Filtros incluidos',                  'Filtros que monta de fábrica.',                                 'text',    null,     null, true, 2150, false),
  ('dispenser_inner_material',          'Material interior depósito',         'Acero inoxidable / plástico FDA.',                              'text',    null,     null, true, 2160, false),
  ('dispenser_sanitization',            'Sistema autosanitización',           'Ninguno / UV / ozono / térmica.',                               'enum',    null, '{"ninguno","UV","ozono","térmica"}', true, 2170, false),
  ('dispenser_noise_dba',               'Nivel ruido',                        'Ruido en operación.',                                           'number',  null,     null, true, 2180, false),
  ('dispenser_energy_class',            'Clase eficiencia energética',        'A / B / C / D / E.',                                            'enum',    null, '{"A","B","C","D","E","F","G"}', true, 2190, false),
  ('dispenser_tap_flow_lmin',           'Caudal grifo',                       'Caudal de servicio.',                                           'number',  'L/min',  null, true, 2200, false),

  -- ===========================================================================
  -- FILTROS (cabezales)
  -- ===========================================================================
  ('filter_media_type',                 'Tipo medio filtrante',               'Melt-blown PP / hilo bobinado / plisado / carbón bloque / GAC / UF.', 'enum', null, '{"melt-blown PP","hilo bobinado","plisado","carbón bloque","carbón granular","UF"}', true, 3010, true),
  ('filter_micron_nominal',             'Micraje nominal',                    'Tamaño nominal de partícula retenida.',                         'number',  'µm',     null, true, 3020, true),
  ('filter_micron_absolute',            'Micraje absoluto',                   'Tamaño absoluto (más exigente).',                               'number',  'µm',     null, true, 3030, false),
  ('filter_size_inches',                'Tamaño',                             'Estándar (10\", 20\", Big Blue 10\", Big Blue 20\").',           'enum',    null, '{"10\"","20\"","Big Blue 10\"","Big Blue 20\""}', true, 3040, true),
  ('filter_max_flow_lmin',              'Caudal máximo',                      'Caudal máximo recomendado.',                                    'number',  'L/min',  null, true, 3050, true),
  ('filter_capacity_l',                 'Capacidad',                          'Litros tratados nominales.',                                    'number',  'L',      null, true, 3060, false),
  ('filter_pressure_drop_initial_bar',  'Pérdida de carga inicial',           'Pérdida de carga inicial a caudal nominal.',                    'number',  'bar',    null, true, 3070, false),
  ('filter_max_pressure_bar',           'Presión máx servicio',               'Presión máxima de trabajo.',                                    'number',  'bar',    null, true, 3080, true),
  ('filter_max_temp_c',                 'Temperatura máx',                    'Temperatura máxima admisible.',                                 'number',  '°C',     null, true, 3090, false),
  ('filter_connection_inches',          'Conexión',                           'Tipo y diámetro de conexión.',                                  'text',    null,     null, true, 3100, false),
  ('filter_body_material',              'Material cuerpo',                    'Habitualmente PP food grade.',                                  'text',    null,     null, true, 3110, false),
  ('filter_chlorine_reduction_pct',     '% Reducción cloro libre',            'Solo aplica a carbón.',                                         'number',  '%',      null, true, 3120, false),
  ('filter_useful_life_months',         'Vida útil',                          'Periodicidad recomendada de cambio.',                           'number',  'mes',    null, true, 3130, false),

  -- ===========================================================================
  -- ESTERILIZADOR UV (también dentro de "filters" como cabezal especial)
  -- ===========================================================================
  ('uv_dose_mjcm2',                     'Dosis UV nominal',                   'Dosis nominal (16 mín, 30 estándar, 40 alto rendimiento).',     'number',  null,     null, true, 4010, true),
  ('uv_flow_at_dose_lmin',              'Caudal a dosis',                     'Caudal de servicio para la dosis dada.',                        'number',  'L/min',  null, true, 4020, true),
  ('uv_lamp_power_w',                   'Potencia lámpara',                   'Potencia de la lámpara UV.',                                    'number',  'W',      null, true, 4030, true),
  ('uv_lamp_life_hours',                'Vida útil lámpara',                  'Horas de uso típicas (~9.000 h = 12 meses).',                   'number',  'h',      null, true, 4040, true),
  ('uv_lamp_type',                      'Tipo lámpara',                       'Baja presión Hg / amalgama / LED UV-C.',                        'enum',    null, '{"baja presión Hg","amalgama","LED UV-C"}', true, 4050, false),
  ('uv_wavelength_nm',                  'Longitud de onda',                   'Habitualmente 254 nm.',                                         'number',  null,     null, true, 4060, false),
  ('uv_chamber_material',               'Cámara material',                    'Acero inoxidable (AISI 304 / 316L).',                           'text',    null,     null, true, 4070, false),
  ('uv_chamber_max_pressure_bar',       'Presión máx cámara',                 'Presión máxima de la cámara.',                                  'number',  'bar',    null, true, 4080, false),
  ('uv_required_uvt_pct',               'Transmitancia UVT requerida',        'UVT mínima a 254 nm.',                                          'number',  '%',      null, true, 4090, false),
  ('uv_connection_inches',              'Conexión',                           'Diámetro de conexión hidráulica.',                              'text',    null,     null, true, 4100, false),
  ('uv_intensity_sensor',               'Sensor intensidad UV',               'Lleva sensor de intensidad UV.',                                'boolean', null,     null, true, 4110, false),
  ('uv_lamp_alarm',                     'Alarma fin vida lámpara',            'Aviso de fin de vida útil.',                                    'boolean', null,     null, true, 4120, false),
  ('uv_voltage_v',                      'Voltaje',                            'Voltaje de alimentación.',                                      'number',  'V',      null, true, 4130, false),
  ('uv_power_total_w',                  'Consumo total',                      'Consumo total incluido balasto.',                               'number',  'W',      null, true, 4140, false),

  -- ===========================================================================
  -- OZONO
  -- ===========================================================================
  ('ozone_production_gh',               'Producción de ozono',                'Gramos por hora generados.',                                    'number',  null,     null, true, 5010, true),
  ('ozone_concentration_ppm',           'Concentración nominal',              'Concentración a caudal nominal.',                               'number',  'ppm',    null, true, 5020, true),
  ('ozone_max_flow_lmin',               'Caudal máximo',                      'Caudal máximo de tratamiento.',                                 'number',  'L/min',  null, true, 5030, true),
  ('ozone_voltage_v',                   'Voltaje',                            'Voltaje de alimentación.',                                      'number',  'V',      null, true, 5040, false),
  ('ozone_power_w',                     'Consumo eléctrico',                  'Consumo eléctrico nominal.',                                    'number',  'W',      null, true, 5050, false),
  ('ozone_generator_tech',              'Tecnología generación',              'Descarga corona / UV.',                                          'enum',    null, '{"descarga corona","UV"}', true, 5060, false),
  ('ozone_lifetime_hours',              'Vida útil celda',                    'Horas estimadas de la celda.',                                  'number',  'h',      null, true, 5070, false),

  -- ===========================================================================
  -- COMUNES (aplican a casi todos los equipos)
  -- ===========================================================================
  ('common_dimensions_mm',              'Dimensiones (mm)',                   'Alto × Ancho × Profundo.',                                      'text',    null,     null, true, 9000, false),
  ('common_weight_kg',                  'Peso',                               'Peso del equipo vacío.',                                        'number',  'kg',     null, true, 9010, false),
  ('common_color',                      'Color',                              'Color principal.',                                              'text',    null,     null, false, 9020, false),
  ('common_installation_type',          'Tipo de instalación',                'Bajo encimera / sobremesa / mural / suelo.',                    'enum',    null, '{"bajo encimera","sobremesa","mural","suelo"}', true, 9030, false)
on conflict (key) do nothing;

-- =============================================================================
-- 3) RELACIÓN ATRIBUTO ↔ CATEGORÍA (qué atributos aparecen sugeridos en cada
--    categoría). Las subcategorías de ósmosis heredan vía la propia query
--    al rellenar el producto: el código en la app puede consultar tanto el
--    parent_key como el key. Aun así, marcamos relación con el padre y con
--    las subcategorías donde hace sentido específico.
-- =============================================================================

-- Helper: insertamos pares (attribute_key, category_key) en un VALUES list
-- y filtramos por existencia para que sea idempotente.
insert into public.product_attributes_global_categories (attribute_key, category_key, is_required)
select v.attribute_key, v.category_key, v.is_required from (values
  -- ÓSMOSIS PADRE
  ('osmosis_production_lday',           'osmosis',                false),
  ('osmosis_production_gpd',            'osmosis',                false),
  ('osmosis_tap_flow_lmin',             'osmosis',                false),
  ('osmosis_tds_rejection_pct',         'osmosis',                false),
  ('osmosis_max_tds_in_ppm',            'osmosis',                false),
  ('osmosis_pressure_min_bar',          'osmosis',                false),
  ('osmosis_pressure_max_bar',          'osmosis',                false),
  ('osmosis_temp_min_c',                'osmosis',                false),
  ('osmosis_temp_max_c',                'osmosis',                false),
  ('osmosis_ph_min',                    'osmosis',                false),
  ('osmosis_ph_max',                    'osmosis',                false),
  ('osmosis_free_chlorine_max_ppm',     'osmosis',                false),
  ('osmosis_stages',                    'osmosis',                false),
  ('osmosis_membrane_size',             'osmosis',                false),
  ('osmosis_membrane_type',             'osmosis',                false),
  ('osmosis_prefilter_life_months',     'osmosis',                false),
  ('osmosis_membrane_life_months',      'osmosis',                false),
  ('osmosis_postfilter_life_months',    'osmosis',                false),
  ('osmosis_recovery_pct',              'osmosis',                false),
  ('common_dimensions_mm',              'osmosis',                false),
  ('common_weight_kg',                  'osmosis',                false),
  ('common_installation_type',          'osmosis',                false),
  -- Ósmosis 5 etapas (con depósito)
  ('osmosis_tank_capacity_l',           'osmosis_5_stages',       false),
  ('osmosis_tank_air_pressure_psi',     'osmosis_5_stages',       false),
  ('osmosis_stages',                    'osmosis_5_stages',       false),
  -- Ósmosis compacta (con depósito, equipo integrado)
  ('osmosis_tank_capacity_l',           'osmosis_compact',        false),
  -- Ósmosis flujo directo (sin depósito, con booster)
  ('osmosis_booster_pump',              'osmosis_direct_flow',    false),
  ('osmosis_booster_voltage_v',         'osmosis_direct_flow',    false),
  ('osmosis_booster_power_w',           'osmosis_direct_flow',    false),

  -- DESCALCIFICADORES
  ('softener_resin_volume_l',           'softeners',              false),
  ('softener_cycle_capacity_fm3',       'softeners',              false),
  ('softener_nominal_flow_m3h',         'softeners',              false),
  ('softener_peak_flow_m3h',            'softeners',              false),
  ('softener_pressure_drop_bar',        'softeners',              false),
  ('softener_salt_per_regen_kg',        'softeners',              false),
  ('softener_salt_efficiency_glr',      'softeners',              false),
  ('softener_water_per_regen_l',        'softeners',              false),
  ('softener_salt_tank_kg',             'softeners',              false),
  ('softener_working_pressure_min_bar', 'softeners',              false),
  ('softener_working_pressure_max_bar', 'softeners',              false),
  ('softener_temp_min_c',               'softeners',              false),
  ('softener_temp_max_c',               'softeners',              false),
  ('softener_ambient_temp_max_c',       'softeners',              false),
  ('softener_max_hardness_fr',          'softeners',              false),
  ('softener_voltage_v',                'softeners',              false),
  ('softener_power_w',                  'softeners',              false),
  ('softener_valve_brand_model',        'softeners',              false),
  ('softener_regen_type',               'softeners',              false),
  ('softener_config',                   'softeners',              false),
  ('softener_tank_material',            'softeners',              false),
  ('softener_bypass_integrated',        'softeners',              false),
  ('softener_wifi_app',                 'softeners',              false),
  ('softener_inlet_outlet_inches',      'softeners',              false),
  ('common_dimensions_mm',              'softeners',              false),
  ('common_weight_kg',                  'softeners',              false),

  -- DISPENSADORES
  ('dispenser_cold_temp_c',             'dispensers',             false),
  ('dispenser_hot_temp_c',              'dispensers',             false),
  ('dispenser_cold_prod_lh',            'dispensers',             false),
  ('dispenser_hot_prod_lh',             'dispensers',             false),
  ('dispenser_cold_tank_l',             'dispensers',             false),
  ('dispenser_hot_tank_l',              'dispensers',             false),
  ('dispenser_cooling_power_w',         'dispensers',             false),
  ('dispenser_heating_power_w',         'dispensers',             false),
  ('dispenser_refrigerant',             'dispensers',             false),
  ('dispenser_refrigerant_charge_g',    'dispensers',             false),
  ('dispenser_voltage_v',               'dispensers',             false),
  ('dispenser_frequency_hz',            'dispensers',             false),
  ('dispenser_power_total_w',           'dispensers',             false),
  ('dispenser_supply_system',           'dispensers',             false),
  ('dispenser_filters_included',        'dispensers',             false),
  ('dispenser_inner_material',          'dispensers',             false),
  ('dispenser_sanitization',            'dispensers',             false),
  ('dispenser_noise_dba',               'dispensers',             false),
  ('dispenser_energy_class',            'dispensers',             false),
  ('dispenser_tap_flow_lmin',           'dispensers',             false),
  ('common_dimensions_mm',              'dispensers',             false),
  ('common_weight_kg',                  'dispensers',             false),
  ('common_installation_type',          'dispensers',             false),

  -- HORECA (heredan de dispensers + ámbito hostelería; mismos atributos básicos)
  ('dispenser_cold_temp_c',             'horeca',                 false),
  ('dispenser_hot_temp_c',              'horeca',                 false),
  ('dispenser_cold_prod_lh',            'horeca',                 false),
  ('dispenser_hot_prod_lh',             'horeca',                 false),
  ('dispenser_power_total_w',           'horeca',                 false),
  ('dispenser_supply_system',           'horeca',                 false),
  ('dispenser_sanitization',            'horeca',                 false),
  ('common_dimensions_mm',              'horeca',                 false),
  ('common_weight_kg',                  'horeca',                 false),

  -- FILTROS (cabezales)
  ('filter_media_type',                 'filters',                false),
  ('filter_micron_nominal',             'filters',                false),
  ('filter_micron_absolute',            'filters',                false),
  ('filter_size_inches',                'filters',                false),
  ('filter_max_flow_lmin',              'filters',                false),
  ('filter_capacity_l',                 'filters',                false),
  ('filter_pressure_drop_initial_bar',  'filters',                false),
  ('filter_max_pressure_bar',           'filters',                false),
  ('filter_max_temp_c',                 'filters',                false),
  ('filter_connection_inches',          'filters',                false),
  ('filter_body_material',              'filters',                false),
  ('filter_chlorine_reduction_pct',     'filters',                false),
  ('filter_useful_life_months',         'filters',                false),
  -- UV también dentro de "filters" como cabezal especial
  ('uv_dose_mjcm2',                     'filters',                false),
  ('uv_flow_at_dose_lmin',              'filters',                false),
  ('uv_lamp_power_w',                   'filters',                false),
  ('uv_lamp_life_hours',                'filters',                false),
  ('uv_lamp_type',                      'filters',                false),
  ('uv_wavelength_nm',                  'filters',                false),
  ('uv_chamber_material',               'filters',                false),
  ('uv_chamber_max_pressure_bar',       'filters',                false),
  ('uv_required_uvt_pct',               'filters',                false),
  ('uv_connection_inches',              'filters',                false),
  ('uv_intensity_sensor',               'filters',                false),
  ('uv_lamp_alarm',                     'filters',                false),
  ('uv_voltage_v',                      'filters',                false),
  ('uv_power_total_w',                  'filters',                false),

  -- OZONO
  ('ozone_production_gh',               'ozone',                  false),
  ('ozone_concentration_ppm',           'ozone',                  false),
  ('ozone_max_flow_lmin',               'ozone',                  false),
  ('ozone_voltage_v',                   'ozone',                  false),
  ('ozone_power_w',                     'ozone',                  false),
  ('ozone_generator_tech',              'ozone',                  false),
  ('ozone_lifetime_hours',              'ozone',                  false),
  ('common_dimensions_mm',              'ozone',                  false),
  ('common_weight_kg',                  'ozone',                  false)
) as v(attribute_key, category_key, is_required)
where exists (select 1 from public.product_attributes_global where key = v.attribute_key)
  and exists (select 1 from public.product_categories_global where key = v.category_key)
on conflict (attribute_key, category_key) do nothing;

notify pgrst, 'reload schema';
