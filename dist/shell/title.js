"use strict";
(() => {
  // src/shell/title.js
  var title = "Dango Cat";
  document.title = title;
  new MutationObserver(() => {
    if (document.title !== title) document.title = title;
  }).observe(document.querySelector("title"), { childList: true });
})();
