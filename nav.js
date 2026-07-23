// Shared top nav + footer, injected into every page.
// Each page sets <body data-page="home|fixtures|ladder|records|teams|finals|rules">.
(function(){
  const PAGES = [
    { key: "home",     label: "Home",     href: "index.html" },
    { key: "fixtures", label: "Fixtures", href: "fixtures.html" },
    { key: "ladder",   label: "Ladder",   href: "ladder.html" },
    { key: "records",  label: "Records",  href: "records.html" },
    { key: "teams",    label: "Teams",    href: "teams.html" },
    { key: "finals",   label: "Finals",   href: "finals.html" },
    { key: "rules",    label: "Rules",    href: "rules.html" },
  ];

  const current = document.body.dataset.page;

  const navHtml = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="index.html">
          <div class="ball-dot"></div>
          <div class="brand-text">
            <div class="display">TERRIGAL OLD BOYS</div>
            <div class="sub">Season 2 · 2026</div>
          </div>
        </a>
        <nav class="tabs">
          ${PAGES.map(p => `<a href="${p.href}" class="${p.key===current ? 'active' : ''}">${p.label}</a>`).join('')}
        </nav>
      </div>
    </header>
  `;

  const footerHtml = `<footer>Terrigal Old Boys Doubles &mdash; Season 2, 2026.</footer>`;

  document.getElementById('nav-placeholder').outerHTML = navHtml;
  document.getElementById('footer-placeholder').outerHTML = footerHtml;
})();
