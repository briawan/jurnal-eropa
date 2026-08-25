/* Komentar per foto.
   Semua isian pengunjung dirender lewat textContent — tidak pernah innerHTML —
   supaya HTML atau script yang diketik orang tidak pernah ikut dieksekusi.
   Kalau API-nya tidak tersedia, skrip ini diam saja dan halaman tampil apa adanya. */
(function () {
  'use strict';

  var page = (location.pathname.split('/').pop() || '');
  if (!page) return;
  if (!/\.html$/i.test(page)) page += '.html';
  if (!/^hari-\d+\.html$/i.test(page)) return;

  var NAME_KEY = 'jurnal-eropa:nama';
  var MAX_NAME = 40;
  var MAX_BODY = 1000;

  var openPanel = null;
  var waktu;
  try {
    waktu = new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    waktu = null;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatWaktu(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return waktu ? waktu.format(d) : d.toLocaleString();
  }

  function photoId(img) {
    var src = img.getAttribute('src') || '';
    return src.split('/').pop().split('?')[0];
  }

  function labelFor(count) {
    return count > 0 ? String(count) : '';
  }

  // Sisipkan panel setelah blok fotonya: setelah <figure>, atau setelah .duo
  // beserta keterangan bersamanya, supaya grid dua kolom tidak terbelah.
  function anchorFor(fig) {
    var block = fig.closest('.duo') || fig;
    var next = block.nextElementSibling;
    if (next && next.classList && next.classList.contains('duo-cap')) return next;
    return block;
  }

  function renderThread(list, comments) {
    list.textContent = '';
    if (!comments.length) {
      list.appendChild(el('p', 'cmt-empty', 'Belum ada komentar untuk foto ini.'));
      return;
    }
    comments.forEach(function (c) {
      var item = el('article', 'cmt-item');
      var head = el('p', 'cmt-meta');
      head.appendChild(el('b', null, c.name));
      var when = formatWaktu(c.created_at);
      if (when) head.appendChild(el('span', null, ' · ' + when));
      item.appendChild(head);
      item.appendChild(el('p', 'cmt-body', c.body));
      list.appendChild(item);
    });
  }

  function buildPanel(photo, badge, counts) {
    var panel = el('section', 'cmt-panel');
    panel.setAttribute('aria-label', 'Komentar foto');

    var list = el('div', 'cmt-list');
    list.appendChild(el('p', 'cmt-empty', 'Memuat komentar…'));
    panel.appendChild(list);

    var form = el('form', 'cmt-form');
    form.noValidate = true;

    var nameLabel = el('label', 'cmt-field');
    nameLabel.appendChild(el('span', null, 'Nama'));
    var nameInput = el('input');
    nameInput.type = 'text';
    nameInput.required = true;
    nameInput.maxLength = MAX_NAME;
    nameInput.autocomplete = 'nickname';
    nameInput.placeholder = 'Nama kamu';
    try { nameInput.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    var bodyLabel = el('label', 'cmt-field');
    bodyLabel.appendChild(el('span', null, 'Komentar'));
    var bodyInput = el('textarea');
    bodyInput.required = true;
    bodyInput.rows = 3;
    bodyInput.maxLength = MAX_BODY;
    bodyInput.placeholder = 'Tulis sesuatu tentang foto ini…';
    bodyLabel.appendChild(bodyInput);
    form.appendChild(bodyLabel);

    // Kolom umpan untuk bot; disembunyikan dari mata dan dari pembaca layar.
    var trap = el('div', 'cmt-trap');
    trap.setAttribute('aria-hidden', 'true');
    var trapInput = el('input');
    trapInput.type = 'text';
    trapInput.name = 'website';
    trapInput.tabIndex = -1;
    trapInput.autocomplete = 'off';
    trap.appendChild(trapInput);
    form.appendChild(trap);

    var actions = el('div', 'cmt-actions');
    var submit = el('button', 'cmt-send', 'Kirim');
    submit.type = 'submit';
    actions.appendChild(submit);
    var note = el('span', 'cmt-note', 'Cukup isi nama — tidak perlu daftar.');
    actions.appendChild(note);
    form.appendChild(actions);

    panel.appendChild(form);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = nameInput.value.trim();
      var body = bodyInput.value.trim();
      if (!name) { note.textContent = 'Nama wajib diisi.'; note.className = 'cmt-note cmt-bad'; nameInput.focus(); return; }
      if (!body) { note.textContent = 'Komentarnya masih kosong.'; note.className = 'cmt-note cmt-bad'; bodyInput.focus(); return; }

      submit.disabled = true;
      note.className = 'cmt-note';
      note.textContent = 'Mengirim…';

      fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo: photo, page: page, name: name, body: body, website: trapInput.value
        })
      }).then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      }).then(function (r) {
        if (!r.ok) throw new Error((r.data && r.data.error) || 'Gagal mengirim komentar.');
        try { localStorage.setItem(NAME_KEY, name); } catch (e) {}
        if (r.data.comment) {
          var empty = list.querySelector('.cmt-empty');
          if (empty) list.textContent = '';
          var item = el('article', 'cmt-item');
          var head = el('p', 'cmt-meta');
          head.appendChild(el('b', null, r.data.comment.name));
          var when = formatWaktu(r.data.comment.created_at);
          if (when) head.appendChild(el('span', null, ' · ' + when));
          item.appendChild(head);
          item.appendChild(el('p', 'cmt-body', r.data.comment.body));
          list.appendChild(item);
          counts[photo] = (counts[photo] || 0) + 1;
          badge.querySelector('.cmt-count').textContent = labelFor(counts[photo]);
          badge.classList.add('has-cmt');
        }
        bodyInput.value = '';
        note.textContent = 'Terkirim. Terima kasih!';
        note.className = 'cmt-note cmt-good';
      }).catch(function (err) {
        note.textContent = err.message || 'Gagal mengirim komentar.';
        note.className = 'cmt-note cmt-bad';
      }).then(function () {
        submit.disabled = false;
      });
    });

    return { panel: panel, list: list, nameInput: nameInput, bodyInput: bodyInput };
  }

  function attach(img, counts) {
    var fig = img.closest('figure');
    if (!fig) return;
    var photo = photoId(img);
    if (!photo) return;

    // Bungkus gambar supaya lencananya bisa menempel di sudut foto, bukan di sudut keterangan.
    var wrap = el('span', 'cmt-wrap');
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    var badge = el('button', 'cmt-badge');
    badge.type = 'button';
    var count = counts[photo] || 0;
    if (count > 0) badge.classList.add('has-cmt');
    badge.setAttribute('aria-expanded', 'false');
    badge.title = 'Komentari foto ini';

    var icon = el('span', 'cmt-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '💬';
    badge.appendChild(icon);
    badge.appendChild(el('span', 'cmt-count', labelFor(count)));
    badge.appendChild(el('span', 'cmt-sr', 'Komentar foto ' + photo));
    wrap.appendChild(badge);

    var built = null;

    badge.addEventListener('click', function () {
      if (built && built.panel.isConnected && !built.panel.hidden) {
        built.panel.hidden = true;
        badge.setAttribute('aria-expanded', 'false');
        openPanel = null;
        return;
      }
      if (openPanel && openPanel !== built) {
        openPanel.panel.hidden = true;
        openPanel.badge.setAttribute('aria-expanded', 'false');
      }

      if (!built) {
        built = buildPanel(photo, badge, counts);
        built.badge = badge;
        anchorFor(fig).insertAdjacentElement('afterend', built.panel);

        fetch('/api/comments?photo=' + encodeURIComponent(photo))
          .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('gagal')); })
          .then(function (data) {
            renderThread(built.list, data.comments || []);
            counts[photo] = (data.comments || []).length;
            badge.querySelector('.cmt-count').textContent = labelFor(counts[photo]);
            if (counts[photo] > 0) badge.classList.add('has-cmt');
          })
          .catch(function () {
            built.list.textContent = '';
            built.list.appendChild(el('p', 'cmt-empty', 'Komentar tidak bisa dimuat sekarang.'));
          });
      }

      built.panel.hidden = false;
      badge.setAttribute('aria-expanded', 'true');
      openPanel = built;
      built.panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      (built.nameInput.value ? built.bodyInput : built.nameInput).focus({ preventScroll: true });
    });
  }

  function init(counts) {
    var imgs = document.querySelectorAll('figure img[src^="images/"]');
    if (!imgs.length) return;
    Array.prototype.forEach.call(imgs, function (img) { attach(img, counts); });
    document.documentElement.classList.add('cmt-on');
  }

  // Kalau jumlahnya gagal diambil, tidak ada apa pun yang dipasang —
  // halaman tetap persis seperti sebelum fitur ini ada.
  function start() {
    fetch('/api/comments?page=' + encodeURIComponent(page))
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('gagal')); })
      .then(function (data) { init(data.counts || {}); })
      .catch(function () { /* diam */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
