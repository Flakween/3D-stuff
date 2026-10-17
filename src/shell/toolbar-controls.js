// The editor and Find addon render their controls asynchronously. Keep these
// two buttons beside the controls they belong to if either area rerenders.
(() => {
  const app = document.querySelector('#app');
  const root = document.documentElement;
  let hideButton;
  let showButton;
  let syncQueued = false;

  function setCollapsed(collapsed) {
    root.classList.toggle('tw-toolbar-collapsed', collapsed);
    hideButton?.setAttribute('aria-expanded', String(!collapsed));
    showButton?.setAttribute('aria-expanded', String(!collapsed));
    window.requestAnimationFrame(() => {
      (collapsed ? showButton : hideButton)?.focus();
      window.dispatchEvent(new Event('resize'));
    });
  }

  function makeButton(className, label, symbol, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tw-toolbar-toggle ${className}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<span aria-hidden="true">${symbol}</span><span>${label}</span>`;
    button.addEventListener('click', onClick);
    return button;
  }

  function syncButtons() {
    syncQueued = false;
    const accountControls = app.querySelector('[class*="menu-bar_account-info-group_"]');
    const tabList = app.querySelector('[class*="gui_tab-list_"]');
    const findBar = tabList?.querySelector('.sa-find-bar');

    if (accountControls) {
      if (!hideButton) {
        hideButton = makeButton('tw-hide-toolbar', 'Hide bar', '⌃', () => setCollapsed(true));
      }
      if (hideButton.parentElement !== accountControls) accountControls.append(hideButton);
    }

    if (tabList) {
      if (!showButton) {
        showButton = makeButton('tw-show-toolbar', 'Show bar', '⌄', () => setCollapsed(false));
      }
      if (findBar) {
        if (showButton.previousElementSibling !== findBar) findBar.after(showButton);
      } else if (showButton.parentElement !== tabList) {
        tabList.append(showButton);
      }
    }

    const expanded = !root.classList.contains('tw-toolbar-collapsed');
    hideButton?.setAttribute('aria-expanded', String(expanded));
    showButton?.setAttribute('aria-expanded', String(expanded));
  }

  new MutationObserver(() => {
    if (!syncQueued) {
      syncQueued = true;
      window.requestAnimationFrame(syncButtons);
    }
  }).observe(app, {childList: true, subtree: true});
  syncButtons();
})();
