// Hidromanager landing — interacciones mínimas
(function(){
  // ===== Slider de capturas demo =====
  var slides = document.querySelectorAll('#slides .slide');
  var tabs = document.getElementById('sliderTabs');
  if(!slides.length || !tabs) return;

  slides.forEach(function(s, i){
    var b = document.createElement('button');
    b.textContent = s.dataset.label || ('Vista '+(i+1));
    b.addEventListener('click', function(){ go(i); });
    tabs.appendChild(b);
  });
  var btns = tabs.querySelectorAll('button');
  var current = 0;

  function go(idx){
    slides.forEach(function(s,i){ s.classList.toggle('active', i===idx); });
    btns.forEach(function(b,i){ b.classList.toggle('active', i===idx); });
    current = idx;
  }
  go(0);

  // Auto-rotación cada 4.5s, salvo que el usuario haya clicado un tab
  var auto = setInterval(function(){
    go((current+1) % slides.length);
  }, 4500);

  // ===== Mockup del hero: rota panel/agenda/lead =====
  var mockMain = document.getElementById('mock-main');
  if(mockMain){
    var views = [
      // Panel
      [
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.6rem">',
          '<div style="background:#fff;padding:.6rem;border-radius:8px"><div style="font-size:.65rem;color:#64748B">LEADS HOY</div><div style="font-size:1.3rem;font-weight:800">12</div></div>',
          '<div style="background:#fff;padding:.6rem;border-radius:8px"><div style="font-size:.65rem;color:#64748B">CONTRATOS</div><div style="font-size:1.3rem;font-weight:800;color:#16A34A">+3</div></div>',
        '</div>',
        '<div style="background:#fff;padding:.7rem;border-radius:8px">',
          '<div style="font-size:.7rem;color:#64748B;margin-bottom:.3rem">FACTURACIÓN MES</div>',
          '<svg viewBox="0 0 280 80" style="width:100%;height:80px"><polyline fill="none" stroke="#0EA5E9" stroke-width="2.5" points="0,60 30,55 60,40 90,42 120,30 150,25 180,15 210,18 240,8 280,5"/><polyline fill="rgba(14,165,233,.18)" stroke="none" points="0,60 30,55 60,40 90,42 120,30 150,25 180,15 210,18 240,8 280,5 280,80 0,80"/></svg>',
        '</div>',
        '<div style="margin-top:.5rem;font-size:.72rem;color:#0B4F8A;background:#E0F2FE;padding:.4rem .6rem;border-radius:6px">🟠 3 leads sin contactar · 1 factura vencida</div>'
      ].join(''),
      // Agenda
      [
        '<div style="font-weight:800;margin-bottom:.5rem">Hoy · 5 visitas</div>',
        '<div style="background:#fff;padding:.45rem .6rem;border-radius:6px;border-left:3px solid #16A34A;margin-bottom:.3rem;font-size:.78rem"><strong>09:00</strong> Ósmosis · Juan</div>',
        '<div style="background:#fff;padding:.45rem .6rem;border-radius:6px;border-left:3px solid #16A34A;margin-bottom:.3rem;font-size:.78rem"><strong>10:30</strong> Mantenimiento · Laura</div>',
        '<div style="background:#FFFBEB;padding:.45rem .6rem;border-radius:6px;border-left:3px solid #F59E0B;margin-bottom:.3rem;font-size:.78rem"><strong>12:00</strong> Sin técnico ⚠️</div>',
        '<div style="background:#fff;padding:.45rem .6rem;border-radius:6px;border-left:3px solid #16A34A;margin-bottom:.3rem;font-size:.78rem"><strong>16:00</strong> Visita comercial</div>',
        '<div style="background:#fff;padding:.45rem .6rem;border-radius:6px;border-left:3px solid #16A34A;margin-bottom:.3rem;font-size:.78rem"><strong>18:00</strong> Recogida</div>'
      ].join(''),
      // Lead
      [
        '<div style="background:#fff;padding:.8rem;border-radius:8px">',
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem"><strong>Pilar Rodríguez</strong><span style="background:#FEE2E2;color:#B91C1C;padding:.15rem .5rem;border-radius:999px;font-size:.65rem;font-weight:700">🔥 CALIENTE</span></div>',
          '<div style="font-size:.78rem;color:#475569;margin-bottom:.2rem">📞 612 345 678</div>',
          '<div style="font-size:.78rem;color:#475569;margin-bottom:.2rem">✉️ pilar.r@correo.es</div>',
          '<div style="font-size:.78rem;color:#475569;margin-bottom:.5rem">📍 Móstoles</div>',
          '<div style="font-size:.72rem;color:#334155;padding-left:.6rem;border-left:2px solid #0EA5E9;margin-bottom:.2rem">Llamada · interesada</div>',
          '<div style="font-size:.72rem;color:#334155;padding-left:.6rem;border-left:2px solid #0EA5E9;margin-bottom:.2rem">Email · catálogo</div>',
          '<div style="font-size:.72rem;color:#334155;padding-left:.6rem;border-left:2px solid #16A34A">Visita 02 jun 16:00</div>',
        '</div>'
      ].join('')
    ];
    var idx = 0;
    function paint(){ mockMain.innerHTML = views[idx]; }
    paint();
    setInterval(function(){ idx = (idx+1) % views.length; paint(); }, 3800);
  }
})();
