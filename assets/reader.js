/* AMA-lukija: lataa reader.css ja tämä tiedosto defer-attribuutilla.
 * #ama-reader-data on application/json: [{ number, title, image, alt }].
 * Linkki <a data-ama-open="1" href="alkuperainen.png"> avaa jakson 1;
 * href jää toimivaksi myös ilman JavaScriptiä. Lisäkuvat jätetään datan ulkopuolelle.
 */
(() => {
  "use strict";

  function initialiseReader() {
    if (window.AMAReader || !window.HTMLDialogElement) return;
    const dataElement = document.getElementById("ama-reader-data");
    if (!dataElement) return;

    let source;
    try {
      source = JSON.parse(dataElement.textContent);
    } catch (error) {
      console.warn("AMA-lukijan jaksoluetteloa ei voitu lukea.", error);
      return;
    }
    if (!Array.isArray(source)) return;

    const knownNumbers = new Set();
    const episodes = source.filter((entry) => {
      if (!entry || !Number.isSafeInteger(entry.number) || entry.number < 1 ||
          typeof entry.title !== "string" || typeof entry.image !== "string" ||
          knownNumbers.has(entry.number)) return false;
      try {
        const imageUrl = new URL(entry.image, document.baseURI);
        if (!["http:", "https:", "file:"].includes(imageUrl.protocol)) return false;
      } catch (_) {
        return false;
      }
      knownNumbers.add(entry.number);
      return true;
    }).sort((a, b) => a.number - b.number);
    if (!episodes.length) return;

    const owner = "ama-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const episodeIndex = new Map(episodes.map((episode, index) => [episode.number, index]));
    let currentIndex = -1;
    let isOpen = false;
    let isZoomed = false;
    let opener = null;
    let savedScroll = null;
    let imageSequence = 0;
    let swipeStart = null;
    let backdropPointerDown = false;

    function make(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }

    function button(className, text, label, callback) {
      const element = make("button", className, text);
      element.type = "button";
      if (label) element.setAttribute("aria-label", label);
      element.addEventListener("click", callback);
      return element;
    }

    const dialog = make("dialog", "ama-reader");
    dialog.id = "ama-reader-dialog";
    dialog.setAttribute("aria-labelledby", "ama-reader-title");
    dialog.setAttribute("aria-describedby", "ama-reader-help");

    const shell = make("div", "ama-reader-shell");
    const header = make("header", "ama-reader-header");
    const headingRow = make("div", "ama-reader-heading-row");
    const heading = make("h2", "ama-reader-title");
    heading.id = "ama-reader-title";
    const closeButton = button("ama-reader-button ama-reader-close", "Sulje ×", "Sulje lukutila", close);
    closeButton.autofocus = true;
    headingRow.append(heading, closeButton);

    const toolbar = make("div", "ama-reader-toolbar");
    const previousTop = button("ama-reader-button ama-reader-previous", "← Edellinen", "Edellinen jakso", previous);
    const nextTop = button("ama-reader-button ama-reader-next", "Seuraava →", "Seuraava jakso", next);
    const selectLabel = make("label", "ama-reader-select-label");
    selectLabel.append(make("span", "ama-reader-visually-hidden", "Valitse jakso"));
    const select = make("select", "ama-reader-select");
    select.setAttribute("aria-label", "Valitse jakso");
    episodes.forEach((episode) => {
      const option = make("option", "", episode.number + ". " + episode.title);
      option.value = String(episode.number);
      select.append(option);
    });
    select.addEventListener("change", () => open(Number(select.value)));
    selectLabel.append(select);
    const zoomButton = button("ama-reader-button ama-reader-zoom", "Suurenna", "Näytä kuva alkuperäisessä koossa", () => setZoom(!isZoomed));
    zoomButton.setAttribute("aria-pressed", "false");
    toolbar.append(previousTop, selectLabel, nextTop, zoomButton);
    header.append(headingRow, toolbar);

    const stage = make("div", "ama-reader-stage");
    stage.tabIndex = 0;
    stage.setAttribute("role", "region");
    stage.setAttribute("aria-label", "Sarjakuvakuva. Voit vierittää kuvaa tässä alueessa.");
    const loadStatus = make("p", "ama-reader-load-status");
    loadStatus.setAttribute("role", "status");
    const errorPanel = make("div", "ama-reader-error");
    errorPanel.hidden = true;
    errorPanel.setAttribute("role", "alert");
    errorPanel.append(make("p", "", "Kuvaa ei voitu ladata. Voit yrittää avata alkuperäisen PNG-kuvan erikseen."));
    const imageLink = make("a", "ama-reader-image-link", "Avaa alkuperäinen PNG-kuva ↗");
    imageLink.target = "_blank";
    imageLink.rel = "noopener";
    errorPanel.append(imageLink);
    const page = make("div", "ama-reader-page");
    stage.append(loadStatus, errorPanel, page);

    const footer = make("footer", "ama-reader-footer");
    const bottomNavigation = make("nav", "ama-reader-bottom-navigation");
    bottomNavigation.setAttribute("aria-label", "Jaksojen selaus");
    const previousBottom = button("ama-reader-button", "← Edellinen", "Edellinen jakso", previous);
    const counter = make("p", "ama-reader-counter");
    counter.setAttribute("role", "status");
    counter.setAttribute("aria-live", "polite");
    counter.setAttribute("aria-atomic", "true");
    const nextBottom = button("ama-reader-button", "Seuraava →", "Seuraava jakso", next);
    bottomNavigation.append(previousBottom, counter, nextBottom);
    const help = make("p", "ama-reader-help", "Selaa nuolilla ← → tai pyyhkäisemällä. Home: ensimmäinen · End: viimeinen · Esc: sulje.");
    help.id = "ama-reader-help";
    footer.append(bottomNavigation, help);
    shell.append(header, stage, footer);
    dialog.append(shell);
    document.body.append(dialog);

    const previousButtons = [previousTop, previousBottom];
    const nextButtons = [nextTop, nextBottom];

    function lockScroll() {
      if (savedScroll) return;
      const styles = [
        [document.documentElement, "overflow"],
        [document.body, "overflow"],
        [document.body, "position"],
        [document.body, "top"],
        [document.body, "left"],
        [document.body, "width"]
      ];
      savedScroll = {
        x: window.scrollX,
        y: window.scrollY,
        styles: styles.map(([element, name]) => ({
          element, name, value: element.style.getPropertyValue(name),
          priority: element.style.getPropertyPriority(name)
        }))
      };
      document.documentElement.style.setProperty("overflow", "hidden");
      document.body.style.setProperty("overflow", "hidden");
      document.body.style.setProperty("position", "fixed");
      document.body.style.setProperty("top", -savedScroll.y + "px");
      document.body.style.setProperty("left", -savedScroll.x + "px");
      document.body.style.setProperty("width", "100%");
    }

    function unlockScroll() {
      if (!savedScroll) return;
      const previousScroll = savedScroll;
      savedScroll = null;
      previousScroll.styles.forEach(({ element, name, value, priority }) => {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      });
      window.scrollTo(previousScroll.x, previousScroll.y);
    }

    function historyState() {
      const current = history.state;
      return current && typeof current === "object" && !Array.isArray(current) ? { ...current } : {};
    }

    function ownsHistoryEntry() {
      return Boolean(history.state && history.state.__amaReader && history.state.__amaReader.owner === owner);
    }

    function updateLocation(number, push) {
      const url = new URL(location.href);
      const state = historyState();
      if (push) state.__amaReader = { owner, previousHash: url.hash };
      url.hash = "lue-" + number;
      try {
        if (push) history.pushState(state, "", url);
        else history.replaceState(state, "", url);
      } catch (_) {
        // PNG-linkit ja lukija toimivat myös selaimessa, joka rajoittaa file://-historiaa.
      }
    }

    function setZoom(zoom) {
      const centerX = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, stage.scrollWidth);
      const centerY = (stage.scrollTop + stage.clientHeight / 2) / Math.max(1, stage.scrollHeight);
      isZoomed = Boolean(zoom);
      shell.classList.toggle("ama-is-zoomed", isZoomed);
      zoomButton.textContent = isZoomed ? "Sovita leveyteen" : "Suurenna";
      zoomButton.setAttribute("aria-label", isZoomed ? "Sovita kuva lukutilan leveyteen" : "Näytä kuva alkuperäisessä koossa");
      zoomButton.setAttribute("aria-pressed", String(isZoomed));
      help.textContent = isZoomed
        ? "Alkuperäinen koko: vieritä kuvaa pysty- ja vaakasuunnassa. ← → vaihtavat jaksoa · Esc: sulje."
        : "Selaa nuolilla ← → tai pyyhkäisemällä. Home: ensimmäinen · End: viimeinen · Esc: sulje.";
      swipeStart = null;
      requestAnimationFrame(() => {
        if (!isOpen) return;
        stage.scrollLeft = centerX * stage.scrollWidth - stage.clientWidth / 2;
        stage.scrollTop = centerY * stage.scrollHeight - stage.clientHeight / 2;
      });
    }

    function render(index) {
      currentIndex = index;
      const episode = episodes[index];
      const sequence = ++imageSequence;
      heading.textContent = "Jakso " + episode.number + " — " + episode.title;
      select.value = String(episode.number);
      counter.textContent = (index + 1) + " / " + episodes.length + " jaksoa";
      previousButtons.forEach((element) => { element.disabled = index === 0; });
      nextButtons.forEach((element) => { element.disabled = index === episodes.length - 1; });
      isZoomed = false;
      shell.classList.remove("ama-is-zoomed");
      zoomButton.textContent = "Suurenna";
      zoomButton.setAttribute("aria-label", "Näytä kuva alkuperäisessä koossa");
      zoomButton.setAttribute("aria-pressed", "false");
      help.textContent = "Selaa nuolilla ← → tai pyyhkäisemällä. Home: ensimmäinen · End: viimeinen · Esc: sulje.";
      errorPanel.hidden = true;
      loadStatus.hidden = false;
      loadStatus.textContent = "Kuva latautuu…";
      stage.setAttribute("aria-busy", "true");
      imageLink.href = episode.image;
      const picture = make("img", "ama-reader-image");
      picture.alt = typeof episode.alt === "string" && episode.alt ? episode.alt : "AMA – jakso " + episode.number + ": " + episode.title;
      picture.draggable = false;
      picture.decoding = "async";
      picture.hidden = true;
      picture.addEventListener("load", () => {
        if (sequence !== imageSequence) return;
        picture.hidden = false;
        loadStatus.hidden = true;
        stage.setAttribute("aria-busy", "false");
      });
      picture.addEventListener("error", () => {
        if (sequence !== imageSequence) return;
        loadStatus.hidden = true;
        errorPanel.hidden = false;
        stage.setAttribute("aria-busy", "false");
      });
      page.replaceChildren(picture);
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
      picture.src = episode.image;
      swipeStart = null;
    }

    function open(number, options = {}) {
      const index = episodeIndex.get(Number(number));
      if (index === undefined) return false;
      const wasOpen = isOpen;
      if (!wasOpen) {
        opener = options.opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        lockScroll();
        try {
          dialog.showModal();
        } catch (_) {
          unlockScroll();
          return false;
        }
        isOpen = true;
      }
      if (!wasOpen || index !== currentIndex) render(index);
      if (!options.fromHistory) updateLocation(episodes[index].number, !wasOpen);
      if (!wasOpen) closeButton.focus({ preventScroll: true });
      return true;
    }

    function hide() {
      if (!isOpen) return;
      isOpen = false;
      swipeStart = null;
      if (dialog.open) dialog.close();
      unlockScroll();
      if (opener && opener.isConnected && typeof opener.focus === "function") {
        opener.focus({ preventScroll: true });
      }
      opener = null;
    }

    function close() {
      if (!isOpen) return;
      const goBack = ownsHistoryEntry();
      hide();
      if (goBack) {
        history.back();
      } else if (/^#lue-\d+$/.test(location.hash)) {
        const url = new URL(location.href);
        url.hash = "";
        try { history.replaceState(historyState(), "", url); } catch (_) { /* file:// */ }
      }
    }

    function next() {
      if (isOpen && currentIndex < episodes.length - 1) open(episodes[currentIndex + 1].number);
    }

    function previous() {
      if (isOpen && currentIndex > 0) open(episodes[currentIndex - 1].number);
    }

    function syncLocation() {
      const match = /^#lue-(\d+)$/.exec(location.hash);
      if (match && episodeIndex.has(Number(match[1]))) open(Number(match[1]), { fromHistory: true });
      else hide();
    }

    function isInput(element) {
      return element instanceof Element && Boolean(element.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
    }

    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[data-ama-open]") : null;
      if (!link || !episodeIndex.has(Number(link.dataset.amaOpen))) return;
      if (open(Number(link.dataset.amaOpen), { opener: link })) event.preventDefault();
    });

    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("close", () => { if (isOpen) close(); });
    dialog.addEventListener("pointerdown", (event) => { backdropPointerDown = event.target === dialog; });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && backdropPointerDown) close();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isInput(event.target)) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); previous(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); next(); }
      else if (event.key === "Home") { event.preventDefault(); open(episodes[0].number); }
      else if (event.key === "End") { event.preventDefault(); open(episodes[episodes.length - 1].number); }
    });
    stage.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || !event.isPrimary || isZoomed || isInput(event.target) ||
          (event.target instanceof Element && event.target.closest("a, button"))) {
        swipeStart = null;
        return;
      }
      swipeStart = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
    });
    dialog.addEventListener("pointerup", (event) => {
      const start = swipeStart;
      swipeStart = null;
      if (!start || event.pointerId !== start.id || isZoomed || !isOpen) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.6 && performance.now() - start.time < 800) {
        if (dx < 0) next();
        else previous();
      }
    });
    dialog.addEventListener("pointercancel", () => { swipeStart = null; });
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("hashchange", syncLocation);
    window.AMAReader = Object.freeze({ open, close, next, previous });
    syncLocation();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseReader, { once: true });
  else initialiseReader();
})();
