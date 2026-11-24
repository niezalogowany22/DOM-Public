// Komunikat, gdy aplikacja nie wystartuje (zamiast pustego ekranu).
function showBootError(msg) {
  var v = document.getElementById('view');
  if (v && v.textContent.indexOf('Ładowanie') >= 0) {
    v.innerHTML = '<section class="card warn"><h2>Błąd uruchomienia</h2><p></p></section>';
    v.querySelector('p').textContent = String(msg);
  }
}
window.addEventListener('error', function (e) { if (e.message) showBootError(e.message + ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')'); });
window.addEventListener('unhandledrejection', function (e) { showBootError((e.reason && e.reason.message) || e.reason); });
