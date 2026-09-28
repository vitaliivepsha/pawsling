// Show one language: ?lang=, else the device's language when it is Ukrainian, else English.
// Without JavaScript both versions are shown one after another.
(function () {
  var q = /[?&]lang=(\w+)/.exec(location.search), nav = (navigator.language || '').slice(0, 2).toLowerCase();
  var l = q ? q[1] : nav === 'uk' ? 'uk' : 'en';
  if (!document.querySelector('article[data-l="' + l + '"]')) l = 'en';
  document.documentElement.className = 'js';
  document.documentElement.lang = l;
  document.querySelectorAll('[data-l]').forEach(function (el) { el.classList.toggle('on', el.getAttribute('data-l') === l); });
})();
