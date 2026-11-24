// Motyw przed narysowaniem strony (bez mignięcia). Osobny plik, bo CSP nie pozwala na skrypty w HTML.
try { var t = localStorage.getItem('dom:theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
