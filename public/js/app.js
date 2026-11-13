/* SAMS front-end behaviour: theme, mobile nav, chart tooltips.
   No dependencies, no build step. */
(function () {
  'use strict';

  /* ------------------------------------------------------------ theme */
  // The inline script in head.ejs already applied the stored theme before
  // first paint; this only wires the toggle.
  var root = document.documentElement;

  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('sams-theme', next); } catch (e) { /* private mode */ }
      btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    });
  });

  /* -------------------------------------------------------- mobile nav */
  var sidebar = document.querySelector('.sidebar');
  var toggle = document.querySelector('[data-nav-toggle]');
  var scrim = document.querySelector('.scrim');

  function setNav(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('is-open', open);
    if (scrim) scrim.classList.toggle('is-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }
  if (toggle) toggle.addEventListener('click', function () {
    setNav(!sidebar.classList.contains('is-open'));
  });
  if (scrim) scrim.addEventListener('click', function () { setNav(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setNav(false);
  });

  /* ---------------------------------------------------- chart tooltips */
  // Tooltips ENHANCE; they never gate a value. Every chart also ships a
  // "Show data table" twin, and keyboard focus shows the same as hover.
  var tip = null;

  function showTip(target) {
    var text = target.getAttribute('data-tip');
    if (!text) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'viz-tooltip';
      tip.setAttribute('role', 'status');
      document.body.appendChild(tip);
    }
    tip.innerHTML = text;
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';

    var r = target.getBoundingClientRect();
    var t = tip.getBoundingClientRect();
    var left = r.left + r.width / 2 - t.width / 2;
    var top = r.top - t.height - 8;

    // keep it on screen
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    if (top < 8) top = r.bottom + 8;

    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
    tip.style.visibility = 'visible';

    // crosshair on line charts
    var svg = target.ownerSVGElement;
    if (svg && target.hasAttribute('data-cx')) {
      var cross = svg.querySelector('.viz-crosshair');
      if (cross) {
        var l = cross.querySelector('line');
        l.setAttribute('x1', target.getAttribute('data-cx'));
        l.setAttribute('x2', target.getAttribute('data-cx'));
        cross.removeAttribute('hidden');
      }
    }
  }

  function hideTip(target) {
    if (tip) tip.style.display = 'none';
    var svg = target && target.ownerSVGElement;
    if (svg) {
      var cross = svg.querySelector('.viz-crosshair');
      if (cross) cross.setAttribute('hidden', '');
    }
  }

  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t) showTip(t);
  });
  document.addEventListener('mouseout', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t) hideTip(t);
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t) showTip(t);
  });
  document.addEventListener('focusout', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t) hideTip(t);
  });
  window.addEventListener('scroll', function () { if (tip) tip.style.display = 'none'; }, true);

  /* --------------------------------------- attendance sheet behaviour */
  var table = document.getElementById('studentTable');
  if (table) {
    document.querySelectorAll('[data-all]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var want = btn.getAttribute('data-all');
        table.querySelectorAll('tbody tr').forEach(function (tr) {
          if (tr.hidden) return;                       // respect the active filter
          var input = tr.querySelector('input[value="' + want + '"]');
          if (input) input.checked = true;
        });
        updateTally();
      });
    });

    var search = document.getElementById('search');
    if (search) {
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        var shown = 0;
        table.querySelectorAll('tbody tr').forEach(function (tr) {
          var match = !q || (tr.dataset.name || '').indexOf(q) !== -1;
          tr.hidden = !match;
          if (match) shown++;
        });
        var note = document.getElementById('searchNote');
        if (note) note.textContent = q ? shown + ' shown' : '';
      });
    }

    // Live tally so the professor sees the effect before saving.
    function updateTally() {
      var counts = { Present: 0, Absent: 0, Late: 0 };
      table.querySelectorAll('input[type=radio]:checked').forEach(function (i) {
        if (counts[i.value] !== undefined) counts[i.value]++;
      });
      var total = counts.Present + counts.Absent + counts.Late;
      Object.keys(counts).forEach(function (k) {
        var el = document.querySelector('[data-tally="' + k + '"]');
        if (el) el.textContent = counts[k];
      });
      var pctEl = document.getElementById('tallyPct');
      if (pctEl) {
        var pct = total ? ((counts.Present + counts.Late) / total) * 100 : 0;
        pctEl.textContent = pct.toFixed(0) + '%';
      }
    }
    table.addEventListener('change', updateTally);
    updateTally();
  }

  /* --------------------------------------------- marks entry max sync */
  var outOf = document.getElementById('outof_marks');
  if (outOf) {
    var apply = function () {
      var m = Number(outOf.value) || 0;
      document.querySelectorAll('.mark-input').forEach(function (i) { i.max = m; });
    };
    outOf.addEventListener('input', apply);
    apply();
  }
})();
