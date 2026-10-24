(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Theme ---------- */
  var root = document.documentElement;
  var themeBtn = document.getElementById("themeToggle");
  function setTheme(theme, persist) {
    root.setAttribute("data-theme", theme);
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      var label = theme === "dark" ? "Đang dùng giao diện tối, bấm để chuyển sáng" : "Đang dùng giao diện sáng, bấm để chuyển tối";
      themeBtn.setAttribute("aria-label", label);
      themeBtn.title = label;
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#10160f" : "#143d29");
    if (persist) {
      try { localStorage.setItem("mh-theme", theme); } catch (e) {}
    }
  }
  setTheme(root.getAttribute("data-theme") || "light", false);
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true);
    });
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem("mh-theme"); } catch (e) {}
  if (!savedTheme && window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onSystem = function (event) { setTheme(event.matches ? "dark" : "light", false); };
    if (mq.addEventListener) mq.addEventListener("change", onSystem);
    else if (mq.addListener) mq.addListener(onSystem);
  }

  /* ---------- Nav dropdowns (hover on desktop, direct link on touch) ---------- */
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var drops = Array.prototype.slice.call(document.querySelectorAll(".navdrop"));
  function closeAll(except) {
    drops.forEach(function (drop) {
      if (drop === except) return;
      drop.classList.remove("open");
      var btn = drop.querySelector(".drop-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }
  drops.forEach(function (drop) {
    var btn = drop.querySelector(".drop-btn");
    var closeTimer = null;
    if (!btn) return;
    function open() {
      if (closeTimer) clearTimeout(closeTimer);
      closeAll(drop);
      drop.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    }
    function close() {
      drop.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }
    if (finePointer) {
      drop.addEventListener("mouseenter", open);
      drop.addEventListener("mouseleave", function () {
        closeTimer = setTimeout(close, 180);
      });
    }
    drop.addEventListener("focusin", open);
    drop.addEventListener("focusout", function (event) {
      if (!drop.contains(event.relatedTarget)) close();
    });
  });
  document.addEventListener("click", function (event) {
    var inside = drops.some(function (drop) { return drop.contains(event.target); });
    if (!inside) closeAll();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeAll();
  });

  /* ---------- News ticker ---------- */
  var tickerTitle = document.getElementById("tickerTitle");
  var tickerData = document.getElementById("tickerData");
  if (tickerTitle && tickerData) {
    var tickerItems = Array.prototype.slice.call(tickerData.querySelectorAll("a"));
    var tickerIndex = 0;
    var tickerTimer = null;
    var renderTicker = function (index) {
      if (!tickerItems.length) return;
      tickerIndex = (index + tickerItems.length) % tickerItems.length;
      var item = tickerItems[tickerIndex];
      tickerTitle.textContent = item.getAttribute("data-title") || "";
      tickerTitle.href = item.getAttribute("href");
    };
    var startTicker = function () {
      if (tickerTimer) clearInterval(tickerTimer);
      if (tickerItems.length < 2 || reduceMotion) return;
      tickerTimer = setInterval(function () { renderTicker(tickerIndex + 1); }, 4500);
    };
    var prev = document.getElementById("tickerPrev");
    var next = document.getElementById("tickerNext");
    if (prev) prev.addEventListener("click", function () { renderTicker(tickerIndex - 1); startTicker(); });
    if (next) next.addEventListener("click", function () { renderTicker(tickerIndex + 1); startTicker(); });
    renderTicker(0);
    startTicker();
  }

  /* ---------- Hero slider ---------- */
  var slider = document.getElementById("heroSlider");
  if (slider) {
    var slides = Array.prototype.slice.call(slider.querySelectorAll(".hero-slide"));
    var dots = Array.prototype.slice.call(document.querySelectorAll(".slider-dot"));
    var slideIndex = 0;
    var slideTimer = null;
    var showSlide = function (index) {
      if (!slides.length) return;
      slideIndex = (index + slides.length) % slides.length;
      slides.forEach(function (slide, i) { slide.classList.toggle("active", i === slideIndex); });
      dots.forEach(function (dot, i) { dot.classList.toggle("active", i === slideIndex); });
    };
    var startSlider = function () {
      if (slideTimer) clearInterval(slideTimer);
      if (slides.length < 2 || reduceMotion) return;
      slideTimer = setInterval(function () { showSlide(slideIndex + 1); }, 7000);
    };
    var stopSlider = function () { if (slideTimer) clearInterval(slideTimer); };
    var prevSlide = slider.querySelector(".slider-nav.prev");
    var nextSlide = slider.querySelector(".slider-nav.next");
    if (prevSlide) prevSlide.addEventListener("click", function () { showSlide(slideIndex - 1); startSlider(); });
    if (nextSlide) nextSlide.addEventListener("click", function () { showSlide(slideIndex + 1); startSlider(); });
    dots.forEach(function (dot, index) {
      dot.addEventListener("click", function () { showSlide(index); startSlider(); });
    });
    slider.addEventListener("mouseenter", stopSlider);
    slider.addEventListener("mouseleave", startSlider);
    slider.addEventListener("focusin", stopSlider);
    slider.addEventListener("focusout", startSlider);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopSlider();
      else startSlider();
    });
    startSlider();
  }

  /* ---------- Reading progress ---------- */
  var progress = document.getElementById("progress");
  var article = document.querySelector(".article");
  if (progress && article) {
    progress.style.display = "block";
    var updateProgress = function () {
      var total = document.documentElement.scrollHeight - window.innerHeight;
      var pct = total > 0 ? (window.scrollY / total) * 100 : 0;
      progress.style.width = Math.max(0, Math.min(100, pct)) + "%";
    };
    window.addEventListener("scroll", updateProgress, { passive: true });
    updateProgress();
  }

  /* ---------- Wifi checklist ---------- */
  var checkList = document.getElementById("checkList");
  if (checkList) {
    var KEY = "mh-checklist-v1";
    var state = [];
    try {
      state = JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch (e) { state = []; }
    var items = Array.prototype.slice.call(checkList.querySelectorAll("li"));
    state = items.map(function (_, i) { return Boolean(state[i]); });
    var paint = function () {
      var done = 0;
      items.forEach(function (item, i) {
        var on = state[i];
        item.classList.toggle("done", on);
        item.setAttribute("aria-pressed", on ? "true" : "false");
        var box = item.querySelector(".box");
        if (box) box.textContent = on ? "✓" : "";
        if (on) done += 1;
      });
      var bar = document.getElementById("checkBar");
      if (bar) bar.style.width = (done / items.length) * 100 + "%";
      var doneMsg = document.getElementById("checkDone");
      if (doneMsg) doneMsg.style.display = done === items.length ? "block" : "none";
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    };
    items.forEach(function (item, index) {
      var toggle = function () { state[index] = !state[index]; paint(); };
      item.addEventListener("click", toggle);
      item.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
    });
    paint();
  }

  /* ---------- Legacy hash URLs (#bai-viet/slug) ---------- */
  var hash = window.location.hash || "";
  var legacy = /^#bai-viet\/(.+)$/.exec(hash);
  if (legacy) {
    try {
      window.location.replace("/bai-viet/" + encodeURIComponent(decodeURIComponent(legacy[1])));
      return;
    } catch (error) {
      // Ignore malformed legacy hashes and keep the normal page.
    }
  }

  /* ---------- Image drag deterrent (not a security control) ---------- */
  document.addEventListener("dragstart", function (event) {
    if (event.target && event.target.tagName === "IMG") event.preventDefault();
  });
})();
