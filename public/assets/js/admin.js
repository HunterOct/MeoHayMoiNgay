(function () {
  "use strict";

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

  /* Confirm destructive submits (forms or specific submit buttons). */
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.tagName !== "FORM") return;
    var submitter = event.submitter;
    var message = (submitter && submitter.getAttribute("data-confirm")) || form.getAttribute("data-confirm");
    if (message && !window.confirm(message)) event.preventDefault();
  });

  /* Select-all checkbox */
  var selectAll = document.getElementById("selectAll");
  if (selectAll) {
    selectAll.addEventListener("change", function () {
      document.querySelectorAll('input[name="ids"]').forEach(function (box) {
        box.checked = selectAll.checked;
      });
    });
  }

  /* Copy buttons */
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var target = document.querySelector(button.getAttribute("data-copy"));
      if (!target) return;
      var text = target.textContent.trim();
      var done = function () {
        var old = button.textContent;
        button.textContent = "Đã sao chép";
        setTimeout(function () { button.textContent = old; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {});
      } else {
        var range = document.createRange();
        range.selectNodeContents(target);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        try { document.execCommand("copy"); done(); } catch (e) {}
        selection.removeAllRanges();
      }
    });
  });

  /* Media picker */
  document.querySelectorAll("[data-open-media]").forEach(function (button) {
    button.addEventListener("click", function () {
      window.__mediaTarget = button.getAttribute("data-target") || "#cover_image";
      var win = window.open("/admin/media?pick=1", "mhMediaPicker", "width=1120,height=820,scrollbars=yes");
      if (!win) window.alert("Trình duyệt đã chặn cửa sổ thư viện ảnh. Hãy cho phép popup rồi thử lại.");
    });
  });
  document.querySelectorAll("[data-pick-url]").forEach(function (button) {
    button.addEventListener("click", function () {
      var opener = window.opener;
      var url = button.getAttribute("data-pick-url");
      if (!opener) {
        window.alert("Không tìm thấy cửa sổ soạn bài. Hãy mở thư viện ảnh từ nút “Chọn” trong trình soạn thảo.");
        return;
      }
      var selector = opener.__mediaTarget || "#cover_image";
      var input = opener.document.querySelector(selector);
      if (input) {
        input.value = url;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        window.close();
      } else {
        window.alert("Không tìm thấy ô nhập ảnh trong trình soạn thảo.");
      }
    });
  });

  /* Inline cover preview */
  var coverInput = document.getElementById("cover_image");
  if (coverInput) {
    var paintCover = function () {
      var preview = document.getElementById("coverPreview");
      if (!preview) return;
      preview.src = coverInput.value;
      preview.style.display = coverInput.value ? "" : "none";
    };
    coverInput.addEventListener("input", paintCover);
    coverInput.addEventListener("change", paintCover);
    paintCover();
  }

  /* Editor toolbar */
  var content = document.getElementById("content");
  var formatSelect = document.getElementById("contentFormat");
  if (content) {
    var insert = function (before, after, placeholder) {
      var start = content.selectionStart;
      var end = content.selectionEnd;
      var selected = content.value.slice(start, end) || placeholder || "";
      content.setRangeText(before + selected + after, start, end, "end");
      content.focus();
      content.dispatchEvent(new Event("input", { bubbles: true }));
    };
    var markdown = {
      h2: ["## ", "", "Tiêu đề mục"],
      h3: ["### ", "", "Tiêu đề nhỏ"],
      bold: ["**", "**", "chữ đậm"],
      italic: ["*", "*", "chữ nghiêng"],
      ul: ["- ", "", "mục danh sách"],
      ol: ["1. ", "", "mục danh sách"],
      quote: ["> ", "", "trích dẫn"],
      link: ["[", "](https://)", "văn bản liên kết"],
      image: ["![", "](/media/ten-anh.jpg)", "mô tả ảnh"],
    };
    var html = {
      h2: ["<h2>", "</h2>", "Tiêu đề mục"],
      h3: ["<h3>", "</h3>", "Tiêu đề nhỏ"],
      bold: ["<strong>", "</strong>", "chữ đậm"],
      italic: ["<em>", "</em>", "chữ nghiêng"],
      ul: ["<ul>\n  <li>", "</li>\n</ul>", "mục danh sách"],
      ol: ["<ol>\n  <li>", "</li>\n</ol>", "mục danh sách"],
      quote: ["<blockquote>", "</blockquote>", "trích dẫn"],
      link: ['<a href="https://">', "</a>", "văn bản liên kết"],
      image: ['<img src="/media/ten-anh.jpg" alt="', '">', "mô tả ảnh"],
    };
    var toolbar = document.querySelector("[data-toolbar]");
    if (toolbar) {
      toolbar.addEventListener("click", function (event) {
        var button = event.target.closest("[data-insert]");
        if (!button) return;
        var key = button.getAttribute("data-insert");
        var isHtml = formatSelect && formatSelect.value === "html";
        var set = isHtml ? html[key] : markdown[key];
        if (set) insert(set[0], set[1], set[2]);
      });
    }
  }

  /* Slug preview */
  var titleInput = document.getElementById("title");
  var slugInput = document.getElementById("slug");
  var slugPreview = document.getElementById("slugPreview");
  function slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 90)
      .replace(/-+$/g, "");
  }
  if (titleInput && slugInput) {
    var slugTouched = Boolean(slugInput.value.trim());
    var paintSlug = function () {
      if (slugPreview) slugPreview.textContent = slugInput.value.trim() || slugify(titleInput.value) || "…";
    };
    slugInput.addEventListener("input", function () {
      slugTouched = true;
      paintSlug();
    });
    titleInput.addEventListener("input", function () {
      if (!slugTouched) slugInput.value = slugify(titleInput.value);
      paintSlug();
    });
    paintSlug();
  }

  /* Character counters */
  var counters = {
    title: "titleCounter",
    excerpt: "excerptCounter",
    seo_title: "seoTitleCounter",
    seo_description: "seoDescCounter",
  };
  Object.keys(counters).forEach(function (id) {
    var input = document.getElementById(id);
    var target = document.getElementById(counters[id]);
    if (!input || !target) return;
    var max = Number(input.getAttribute("data-counter")) || 0;
    var update = function () {
      target.textContent = input.value.length + "/" + max;
      target.classList.toggle("over", input.value.length > max);
    };
    input.addEventListener("input", update);
    update();
  });

  /* Unsaved-changes protection + Ctrl/Cmd+S */
  var form = document.getElementById("postForm");
  if (form) {
    var dirty = false;
    form.addEventListener("input", function () { dirty = true; });
    form.addEventListener("submit", function () { dirty = false; });
    window.addEventListener("beforeunload", function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        var save = form.querySelector('button[name="action"][value="save"]');
        if (save) save.click();
      }
    });
  }
})();
