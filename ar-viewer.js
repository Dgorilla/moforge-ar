/**
 * ar-viewer.js — shared AR product-preview component for Aksum & Co..
 * One module powers: store product pages, the QR landing route (/ar/<id>/), the
 * custom-size variant picker, and the internal design-validation tool.
 *
 * No build step, no framework — plain script, works with a single
 * `<script src="/ar-viewer.js" defer></script>` tag. The official <model-viewer>
 * library itself is lazy-loaded (see loadModelViewerLib below) so it never blocks
 * first paint, and only downloads once even if a page has multiple viewers.
 *
 * Usage: give a container element `class="arv-wrap" data-arv` plus data-* attributes
 * (see README.md "Add a new product" section for the full attribute list), then call
 * `ARViewer.init()` once after the DOM is ready. See Web/store/example-headphone-hook.html
 * for a complete working example.
 */
(function (global) {
  "use strict";

  // Official <model-viewer> distribution via jsdelivr, per Google's own recommended CDN
  // usage — never vendored/reinvented locally, per the "prefer the official library" ask.
  const MODEL_VIEWER_SRC =
    "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";

  let modelViewerLoadPromise = null;

  /** Lazy-loads the <model-viewer> custom element definition exactly once, no matter how
   * many viewer instances are on the page. Returns a promise that resolves once the
   * `<model-viewer>` tag is safe to use. Deferred until a viewer is actually about to be
   * shown (see init()'s IntersectionObserver) rather than on page load, so a product page
   * with the viewer below the fold doesn't pay the download cost until scrolled to. */
  function loadModelViewerLib() {
    if (modelViewerLoadPromise) return modelViewerLoadPromise;
    modelViewerLoadPromise = new Promise((resolve, reject) => {
      if (customElements.get("model-viewer")) return resolve();
      const script = document.createElement("script");
      script.type = "module";
      script.src = MODEL_VIEWER_SRC;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("model-viewer library failed to load"));
      document.head.appendChild(script);
    });
    return modelViewerLoadPromise;
  }

  /** Real-world dimensions, in mm, from data attributes. Used both for the on-screen
   * "W × D × H" label and (in the internal tool) validated against the model's own
   * measured bounding box after load. */
  function readDims(el) {
    const w = parseFloat(el.dataset.widthMm);
    const d = parseFloat(el.dataset.depthMm);
    const h = parseFloat(el.dataset.heightMm);
    if ([w, d, h].some((n) => Number.isNaN(n))) return null;
    return { w, d, h };
  }

  function fmtDims(dims) {
    if (!dims) return "";
    return `${dims.w} × ${dims.d} × ${dims.h} mm (W×D×H)`;
  }

  /** Builds the actual <model-viewer> element + surrounding chrome (spinner, error box,
   * footer with name/dims/AR button) inside `container`. Idempotent — calling it again on
   * the same container (e.g. after a variant switch) replaces the model-viewer element's
   * sources without rebuilding the whole card, so the camera/lighting setup doesn't flash. */
  function mount(container, opts) {
    const mv = document.createElement("model-viewer");
    mv.setAttribute("src", opts.glb);
    if (opts.usdz) mv.setAttribute("ios-src", opts.usdz);
    if (opts.poster) mv.setAttribute("poster", opts.poster);
    mv.setAttribute("alt", opts.name || "3D product preview");
    mv.setAttribute("camera-controls", "");
    mv.setAttribute("auto-rotate", "");
    mv.setAttribute("shadow-intensity", "1");
    mv.setAttribute("ar", "");
    mv.setAttribute("ar-modes", "webxr scene-viewer quick-look");
    mv.setAttribute("ar-scale", "fixed"); // true-to-life scale in AR — never let the platform auto-resize to fill view
    if (opts.animated) {
      mv.setAttribute("autoplay", "");
      mv.setAttribute("animation-name", "");
    }

    const spinner = document.createElement("div");
    spinner.className = "arv-spinner";
    spinner.setAttribute("role", "status");
    spinner.setAttribute("aria-label", "Loading 3D model");

    const errorBox = document.createElement("div");
    errorBox.className = "arv-error";
    errorBox.hidden = true;
    errorBox.textContent = "This model couldn't load. Check your connection and reload the page.";

    const arButton = document.createElement("button");
    arButton.slot = "ar-button";
    arButton.className = "arv-ar-button";
    arButton.type = "button";
    arButton.setAttribute("aria-label", `View ${opts.name || "this product"} in your space using AR`);
    arButton.innerHTML = "&#128241;&nbsp; View in your space";
    mv.appendChild(arButton);

    container.querySelectorAll("model-viewer, .arv-spinner, .arv-error").forEach((n) => n.remove());
    container.prepend(errorBox);
    container.prepend(spinner);
    container.prepend(mv);

    mv.addEventListener("load", () => {
      spinner.hidden = true;
      errorBox.hidden = true;
      // Graceful fallback: model-viewer only knows AR is actually launchable (WebXR /
      // Scene Viewer / Quick Look all failed detection, or this is a desktop browser)
      // AFTER load. Hide the AR button and show the "AR works on mobile" note instead of
      // presenting a button that would silently do nothing on tap.
      const desktopNote = container.querySelector(".arv-desktop-note");
      if (desktopNote) desktopNote.hidden = mv.canActivateAR;
      arButton.hidden = !mv.canActivateAR;

      if (opts.onLoad) opts.onLoad(mv);
    });

    mv.addEventListener("error", () => {
      spinner.hidden = true;
      errorBox.hidden = false;
    });

    return mv;
  }

  /** Renders the name/dimensions footer + (optionally) variant and animation control rows.
   * Kept separate from mount() since these don't change on every variant swap. */
  function renderFooter(container, opts) {
    let footer = container.querySelector(".arv-footer");
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "arv-footer";
      container.appendChild(footer);
    }
    footer.innerHTML = "";

    if (opts.variants && opts.variants.length > 1) {
      const row = document.createElement("div");
      row.className = "arv-variants";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Choose a size or variant");
      opts.variants.forEach((v) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "arv-variant-btn";
        btn.textContent = v.label;
        btn.setAttribute("aria-pressed", String(v.id === opts.activeVariantId));
        btn.addEventListener("click", () => opts.onVariantChange(v.id));
        row.appendChild(btn);
      });
      footer.appendChild(row);
    }

    const name = document.createElement("p");
    name.className = "arv-name";
    name.textContent = opts.name || "";
    footer.appendChild(name);

    const dims = document.createElement("p");
    dims.className = "arv-dims";
    dims.textContent = fmtDims(opts.dims);
    footer.appendChild(dims);

    if (opts.animated) {
      const animRow = document.createElement("div");
      animRow.className = "arv-anim-controls";
      animRow.hidden = true; // shown by wireAnimationControls() only if the model actually has animation clips
      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "arv-anim-btn";
      playBtn.textContent = "Pause";
      const loopBtn = document.createElement("button");
      loopBtn.type = "button";
      loopBtn.className = "arv-anim-btn";
      loopBtn.textContent = "Loop: on";
      const note = document.createElement("span");
      note.className = "arv-anim-note";
      animRow.append(playBtn, loopBtn, note);
      footer.appendChild(animRow);
      footer._animRow = { animRow, playBtn, loopBtn, note };
    }

    const desktopNote = document.createElement("p");
    desktopNote.className = "arv-desktop-note";
    desktopNote.hidden = true;
    desktopNote.textContent = "AR view works on iPhone (Safari) and Android (Chrome) — you're seeing the 3D preview here.";
    footer.appendChild(desktopNote);

    return footer;
  }

  /** Feature 4 — wires play/pause + loop toggle to a model's real animation clips, and
   * hides the whole control row (rather than disabling it) when the model has none. Must
   * run after 'load' since availableAnimations is only populated once the glTF is parsed. */
  function wireAnimationControls(mv, footer) {
    if (!footer._animRow) return;
    const { animRow, playBtn, loopBtn, note } = footer._animRow;
    const clips = mv.availableAnimations || [];
    if (clips.length === 0) {
      animRow.hidden = true;
      note.textContent = "Static pose — no animation embedded in this model.";
      return;
    }
    animRow.hidden = false;
    mv.animationName = clips[0];
    let looping = true;
    let playing = true;
    playBtn.addEventListener("click", () => {
      playing = !playing;
      playBtn.textContent = playing ? "Pause" : "Play";
      if (playing) mv.play({ repetitions: looping ? Infinity : 1 });
      else mv.pause();
    });
    loopBtn.addEventListener("click", () => {
      looping = !looping;
      loopBtn.textContent = looping ? "Loop: on" : "Loop: off";
      if (playing) mv.play({ repetitions: looping ? Infinity : 1 });
    });
  }

  /** Feature 1 support — measures the model's REAL bounding box (model-viewer reports this
   * in meters) and returns it in mm, for the internal design-validation tool to display and
   * compare against the product's declared dimensions. */
  function measureDimensionsMm(mv) {
    const d = mv.getDimensions(); // {x, y, z} in meters, model space
    return { w: +(d.x * 1000).toFixed(1), d: +(d.z * 1000).toFixed(1), h: +(d.y * 1000).toFixed(1) };
  }

  /** Public entry point. Call once after DOMContentLoaded. Finds every `[data-arv]`
   * container on the page and lazy-mounts a viewer into it the moment it scrolls near the
   * viewport (IntersectionObserver, 200px rootMargin) — the actual "defer heavy assets"
   * mechanism, not just a `defer` script tag. */
  function init() {
    const containers = document.querySelectorAll("[data-arv]");
    if (containers.length === 0) return;

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          obs.unobserve(entry.target);
          mountFromDataset(entry.target);
        });
      },
      { rootMargin: "200px" }
    );
    containers.forEach((el) => observer.observe(el));
  }

  function mountFromDataset(container) {
    const dims = readDims(container);
    const opts = {
      glb: container.dataset.glb,
      usdz: container.dataset.usdz,
      poster: container.dataset.poster,
      name: container.dataset.name,
      dims,
      animated: container.dataset.animated === "true",
    };

    let variants = null;
    if (container.dataset.variants) {
      try {
        variants = JSON.parse(container.dataset.variants);
      } catch (e) {
        console.error("ar-viewer: invalid data-variants JSON", e);
      }
    }

    let activeId = variants ? variants[0].id : null;

    function applyVariant(id) {
      const v = variants.find((x) => x.id === id);
      if (!v) return;
      activeId = id;
      loadModelViewerLib().then(() => {
        const mv = mount(container, {
          glb: v.glb,
          usdz: v.usdz,
          poster: v.poster || opts.poster,
          name: opts.name,
          animated: opts.animated,
          onLoad: (mv) => {
            const footer = container.querySelector(".arv-footer");
            wireAnimationControls(mv, footer);
            if (container.dataset.showMeasured === "true") {
              container.dispatchEvent(new CustomEvent("arv:measured", { detail: measureDimensionsMm(mv) }));
            }
          },
        });
        renderFooter(container, {
          ...opts,
          dims: v.dims || opts.dims,
          variants,
          activeVariantId: activeId,
          onVariantChange: applyVariant,
        });
      });
    }

    loadModelViewerLib()
      .then(() => {
        const first = variants ? variants[0] : opts;
        const mv = mount(container, { ...opts, glb: first.glb || opts.glb, usdz: first.usdz || opts.usdz });
        const footer = renderFooter(container, {
          ...opts,
          variants,
          activeVariantId: activeId,
          onVariantChange: applyVariant,
        });
        mv.addEventListener("load", () => {
          wireAnimationControls(mv, footer);
          if (container.dataset.showMeasured === "true") {
            container.dispatchEvent(new CustomEvent("arv:measured", { detail: measureDimensionsMm(mv) }));
          }
        });
      })
      .catch(() => {
        const errorBox = container.querySelector(".arv-error") || document.createElement("div");
        errorBox.className = "arv-error";
        errorBox.textContent = "Couldn't load the 3D viewer library. Check your connection and reload.";
        errorBox.hidden = false;
        if (!container.contains(errorBox)) container.appendChild(errorBox);
      });
  }

  /** Used directly by the internal design-validation tool (Feature 1), which loads a local
   * file the user just picked rather than a hosted URL — bypasses the dataset/IntersectionObserver
   * path entirely since there's exactly one viewer on that page and it must mount immediately. */
  function mountLocalFile(container, file, opts) {
    const objectUrl = URL.createObjectURL(file);
    return loadModelViewerLib().then(() => {
      const mv = mount(container, { glb: objectUrl, name: file.name, ...opts });
      renderFooter(container, { name: file.name, dims: null });
      mv.addEventListener("load", () => {
        const measured = measureDimensionsMm(mv);
        if (opts.onMeasured) opts.onMeasured(measured);
      });
      return mv;
    });
  }

  global.ARViewer = { init, mountLocalFile, measureDimensionsMm, loadModelViewerLib };
})(window);
