const appRoot = document.querySelector('#app');

function fitEditor() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const portrait = viewportWidth < 800 && viewportHeight > viewportWidth;
  const root = document.documentElement;
  const minimumWidth = portrait ? 540 : 1024;
  const minimumHeight = portrait ? 850 : 560;
  const scale = Math.min(1, viewportWidth / minimumWidth, viewportHeight / minimumHeight);

  root.classList.toggle('tw-mobile-portrait', portrait);
  root.classList.toggle('tw-mobile', scale < 1);

  if (scale === 1) {
    appRoot.style.width = '';
    appRoot.style.height = '';
    appRoot.style.transform = '';
    return;
  }

  // The editor has a 1024px minimum side-by-side layout. On portrait
  // screens, its panes stack so controls can remain closer to full size.
  const logicalWidth = Math.max(minimumWidth, viewportWidth / scale);
  appRoot.style.width = `${logicalWidth}px`;
  appRoot.style.height = `${Math.ceil(viewportHeight / scale)}px`;
  appRoot.style.transform = `scale(${scale})`;
}

fitEditor();
window.addEventListener('resize', fitEditor, {passive: true});
window.visualViewport?.addEventListener('resize', fitEditor, {passive: true});
window.addEventListener('orientationchange', () => setTimeout(fitEditor, 120), {passive: true});
