(function () {
  "use strict";

  var DPI = 150; // render resolution used for both screen preview and PDF export
  var MM_PER_IN = 25.4;
  function mm2px(mm) { return (mm / MM_PER_IN) * DPI; }

  var PAPER_MM = {
    letter: { w: 215.9, h: 279.4 },
    a4:     { w: 210,   h: 297   },
    legal:  { w: 215.9, h: 355.6 }
  };

  var PRESETS = {
    broadedge:   { xHeight: 7, ascenderHeight: 7, descenderHeight: 7, showAscender: true,  showWaist: true, showBaseline: true, showDescender: true,  showSlant: false, slantAngle: 55 },
    copperplate: { xHeight: 6, ascenderHeight: 10, descenderHeight: 10, showAscender: false, showWaist: true, showBaseline: true, showDescender: false, showSlant: true,  slantAngle: 55 },
    simple:      { xHeight: 8, ascenderHeight: 0, descenderHeight: 0, showAscender: false, showWaist: false, showBaseline: true, showDescender: false, showSlant: false, slantAngle: 55 }
  };

  var state = {
    mode: "scratch",
    paperSize: "a4",
    orientation: "portrait",
    marginLR: 15,
    marginTB: 15,

    xHeight: 7,
    ascenderHeight: 7,
    descenderHeight: 7,
    setSpacing: 10,
    showAscender: true,
    showWaist: true,
    showBaseline: true,
    showDescender: true,

    showSlant: false,
    slantAngle: 55,
    slantSpacing: 12,

    lineColor: "#2f6fed",
    slantColor: "#9aa3af",
    pageCount: 1,

    photo: {
      img: null,
      opacity: 60,
      scale: 100,
      rotation: 0,
      x: 0, // px offset from canvas center, in canvas pixel space
      y: 0,
      showGuides: true
    }
  };

  var canvas = document.getElementById("sheetCanvas");
  var ctx = canvas.getContext("2d");

  // ---------- element refs ----------
  var el = {};
  [
    "paperSize", "orientation", "marginLR", "marginTB",
    "preset", "xHeight", "setSpacing", "ascenderHeight", "descenderHeight",
    "showAscender", "showWaist", "showBaseline", "showDescender",
    "showSlant", "slantAngle", "slantAngleOut", "slantSpacing",
    "lineColor", "slantColor", "pageCount",
    "photoInput", "photoOpacity", "photoScale", "photoRotation",
    "fitPhotoBtn", "photoShowGuides",
    "downloadBtn", "pageInfo", "scratchPanel", "photoPanel"
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var modeButtons = document.querySelectorAll(".mode-btn");

  // ---------- geometry ----------
  function pageSizeMM() {
    var base = PAPER_MM[state.paperSize];
    if (state.orientation === "landscape") {
      return { w: base.h, h: base.w };
    }
    return { w: base.w, h: base.h };
  }

  function layoutCanvas() {
    var mm = pageSizeMM();
    canvas.width = Math.round(mm2px(mm.w));
    canvas.height = Math.round(mm2px(mm.h));
  }

  // ---------- drawing ----------
  function drawGuideLines() {
    var mm = pageSizeMM();
    var marginL = mm2px(state.marginLR);
    var marginR = mm2px(state.marginLR);
    var marginT = mm2px(state.marginTB);
    var marginB = mm2px(state.marginTB);

    var pageW = canvas.width;
    var pageH = canvas.height;
    var drawX = marginL;
    var drawY = marginT;
    var drawW = pageW - marginL - marginR;
    var drawH = pageH - marginT - marginB;

    if (drawW <= 0 || drawH <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, drawY, drawW, drawH);
    ctx.clip();

    // slant guide lines (drawn first, underneath horizontal lines)
    if (state.showSlant) {
      var angleRad = (state.slantAngle * Math.PI) / 180;
      var dxTotal = drawH / Math.tan(angleRad);
      var spacingPx = mm2px(state.slantSpacing);
      ctx.strokeStyle = state.slantColor;
      ctx.lineWidth = Math.max(1, DPI / 150);
      var startX = drawX - Math.abs(dxTotal) - spacingPx;
      var endX = drawX + drawW + Math.abs(dxTotal) + spacingPx;
      for (var x0 = startX; x0 <= endX; x0 += spacingPx) {
        ctx.beginPath();
        ctx.moveTo(x0, drawY + drawH);
        ctx.lineTo(x0 + dxTotal, drawY);
        ctx.stroke();
      }
    }

    // horizontal rule sets
    var xHeightPx = mm2px(state.xHeight);
    var ascPx = mm2px(state.ascenderHeight);
    var descPx = mm2px(state.descenderHeight);
    var setSpacingPx = mm2px(state.setSpacing);

    var setHeight = ascPx + xHeightPx + descPx;
    var step = setHeight + setSpacingPx;
    if (step <= 0) step = xHeightPx || 20;

    ctx.lineWidth = Math.max(1.2, DPI / 130);

    var baselineY = drawY + ascPx + xHeightPx;
    while (baselineY - descPx <= drawY + drawH + 1) {
      var ascenderY = baselineY - xHeightPx - ascPx;
      var waistY = baselineY - xHeightPx;
      var descenderY = baselineY + descPx;

      if (state.showAscender && ascPx > 0 && ascenderY >= drawY - 1) {
        drawHLine(ascenderY, drawX, drawW, state.lineColor, true);
      }
      if (state.showWaist && waistY >= drawY - 1) {
        drawHLine(waistY, drawX, drawW, state.lineColor, true);
      }
      if (state.showBaseline) {
        drawHLine(baselineY, drawX, drawW, state.lineColor, false);
      }
      if (state.showDescender && descPx > 0) {
        drawHLine(descenderY, drawX, drawW, state.lineColor, true);
      }

      baselineY += step;
    }

    ctx.restore();
  }

  function drawHLine(y, x, w, color, dashed) {
    if (y < 0 || y > canvas.height) return;
    ctx.save();
    ctx.strokeStyle = color;
    if (dashed) ctx.setLineDash([mm2px(2), mm2px(1.2)]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
    ctx.restore();
  }

  function drawPhoto() {
    var p = state.photo;
    if (!p.img) return;
    ctx.save();
    var cx = canvas.width / 2 + p.x;
    var cy = canvas.height / 2 + p.y;
    ctx.translate(cx, cy);
    ctx.rotate((p.rotation * Math.PI) / 180);
    var scale = p.scale / 100;
    var iw = p.img.width * scale;
    var ih = p.img.height * scale;
    ctx.globalAlpha = p.opacity / 100;
    ctx.drawImage(p.img, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  function render() {
    layoutCanvas();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state.mode === "photo") {
      drawPhoto();
      if (state.photo.showGuides) drawGuideLines();
    } else {
      drawGuideLines();
    }

    var mm = pageSizeMM();
    el.pageInfo.textContent =
      (state.mode === "scratch"
        ? "Preview — page 1 of " + state.pageCount
        : "Preview — photo tracing sheet") +
      " · " + mm.w.toFixed(0) + " × " + mm.h.toFixed(0) + " mm";
  }

  // ---------- UI wiring ----------
  function bindNumber(id, key, isFloat) {
    el[id].addEventListener("input", function () {
      state[key] = isFloat ? parseFloat(this.value) || 0 : parseInt(this.value, 10) || 0;
      render();
    });
  }
  function bindCheckbox(id, key) {
    el[id].addEventListener("change", function () {
      state[key] = this.checked;
      render();
    });
  }
  function bindSelect(id, key) {
    el[id].addEventListener("change", function () {
      state[key] = this.value;
      render();
    });
  }

  bindSelect("paperSize", "paperSize");
  bindSelect("orientation", "orientation");
  bindNumber("marginLR", "marginLR", true);
  bindNumber("marginTB", "marginTB", true);

  bindNumber("xHeight", "xHeight", true);
  bindNumber("setSpacing", "setSpacing", true);
  bindNumber("ascenderHeight", "ascenderHeight", true);
  bindNumber("descenderHeight", "descenderHeight", true);
  bindCheckbox("showAscender", "showAscender");
  bindCheckbox("showWaist", "showWaist");
  bindCheckbox("showBaseline", "showBaseline");
  bindCheckbox("showDescender", "showDescender");

  bindCheckbox("showSlant", "showSlant");
  bindNumber("slantSpacing", "slantSpacing", true);
  bindNumber("pageCount", "pageCount", false);

  el.slantAngle.addEventListener("input", function () {
    state.slantAngle = parseInt(this.value, 10);
    el.slantAngleOut.textContent = state.slantAngle + "°";
    render();
  });

  el.lineColor.addEventListener("input", function () {
    state.lineColor = this.value;
    render();
  });
  el.slantColor.addEventListener("input", function () {
    state.slantColor = this.value;
    render();
  });

  el.preset.addEventListener("change", function () {
    var p = PRESETS[this.value];
    if (!p) return;
    Object.assign(state, p);
    el.xHeight.value = state.xHeight;
    el.ascenderHeight.value = state.ascenderHeight;
    el.descenderHeight.value = state.descenderHeight;
    el.showAscender.checked = state.showAscender;
    el.showWaist.checked = state.showWaist;
    el.showBaseline.checked = state.showBaseline;
    el.showDescender.checked = state.showDescender;
    el.showSlant.checked = state.showSlant;
    el.slantAngle.value = state.slantAngle;
    el.slantAngleOut.textContent = state.slantAngle + "°";
    render();
  });

  // mode switch
  modeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      modeButtons.forEach(function (b) {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      state.mode = btn.dataset.mode;
      el.scratchPanel.classList.toggle("hidden", state.mode !== "scratch");
      el.photoPanel.classList.toggle("hidden", state.mode !== "photo");
      render();
    });
  });

  // photo upload
  el.photoInput.addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (evt) {
      var img = new Image();
      img.onload = function () {
        state.photo.img = img;
        state.photo.x = 0;
        state.photo.y = 0;
        fitPhoto();
        render();
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  });

  el.photoOpacity.addEventListener("input", function () {
    state.photo.opacity = parseInt(this.value, 10);
    render();
  });
  el.photoScale.addEventListener("input", function () {
    state.photo.scale = parseInt(this.value, 10);
    render();
  });
  el.photoRotation.addEventListener("input", function () {
    state.photo.rotation = parseInt(this.value, 10);
    render();
  });
  el.photoShowGuides.addEventListener("change", function () {
    state.photo.showGuides = this.checked;
    render();
  });

  function fitPhoto() {
    var p = state.photo;
    if (!p.img) return;
    var mm = pageSizeMM();
    var marginL = mm2px(state.marginLR);
    var marginT = mm2px(state.marginTB);
    var drawW = mm2px(mm.w) - marginL * 2;
    var drawH = mm2px(mm.h) - marginT * 2;
    var scale = Math.min(drawW / p.img.width, drawH / p.img.height) * 100;
    p.scale = Math.max(10, Math.min(300, Math.round(scale)));
    p.rotation = 0;
    p.x = 0;
    p.y = 0;
    el.photoScale.value = p.scale;
    el.photoRotation.value = 0;
  }

  el.fitPhotoBtn.addEventListener("click", function () {
    fitPhoto();
    render();
  });

  // drag photo on canvas
  var dragging = false;
  var dragStart = { x: 0, y: 0, px: 0, py: 0 };

  function canvasScaleFactor() {
    var rect = canvas.getBoundingClientRect();
    return canvas.width / rect.width;
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (state.mode !== "photo" || !state.photo.img) return;
    dragging = true;
    var f = canvasScaleFactor();
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    dragStart.px = state.photo.x;
    dragStart.py = state.photo.y;
    dragStart.f = f;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = (e.clientX - dragStart.x) * dragStart.f;
    var dy = (e.clientY - dragStart.y) * dragStart.f;
    state.photo.x = dragStart.px + dx;
    state.photo.y = dragStart.py + dy;
    render();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (evt) {
    canvas.addEventListener(evt, function () { dragging = false; });
  });

  // ---------- PDF export ----------
  el.downloadBtn.addEventListener("click", function () {
    render();
    var mm = pageSizeMM();
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) {
      alert("PDF library failed to load. Please check your internet connection and try again.");
      return;
    }
    var doc = new jsPDFCtor({
      orientation: "portrait",
      unit: "mm",
      format: [mm.w, mm.h]
    });

    var dataUrl = canvas.toDataURL("image/png", 1.0);
    doc.addImage(dataUrl, "PNG", 0, 0, mm.w, mm.h);

    if (state.mode === "scratch") {
      var count = Math.max(1, Math.min(30, state.pageCount || 1));
      for (var i = 1; i < count; i++) {
        doc.addPage([mm.w, mm.h], "portrait");
        doc.addImage(dataUrl, "PNG", 0, 0, mm.w, mm.h);
      }
    }

    var filename = state.mode === "photo"
      ? "calligraphy-guide-photo-sheet.pdf"
      : "calligraphy-guide-sheet.pdf";
    doc.save(filename);
  });

  // ---------- init ----------
  el.slantAngleOut.textContent = state.slantAngle + "°";
  render();
})();
