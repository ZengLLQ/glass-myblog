/**
 * CanvasRenderer: draws the 2D panel and nav slab graphics in high-DPR code.
 * Implements exact typographic leading, gradients, hover states, and brand modes.
 */

export class CanvasRenderer {
  constructor() {
    this.panelCanvas = document.createElement('canvas');
    this.panelCtx = this.panelCanvas.getContext('2d');

    this.navCanvas = document.createElement('canvas');
    this.navCtx = this.navCanvas.getContext('2d');

    // Interactive states
    this.isButtonHovered = false;
    this.isLinkHovered = false;
    this.isNavContactHovered = false;
    this.hoveredNavLinkIndex = -1;

    // Mode: 'jaycee' (default) or 'facet'
    this.mode = 'jaycee';

    // Store layout hitboxes in panel coordinates
    this.hitboxes = {
      button: { x: 0, y: 0, w: 0, h: 0 },
      link: { x: 0, y: 0, w: 0, h: 0 },
      navContact: { x: 0, y: 0, w: 0, h: 0 },
      navLinks: []
    };
  }

  setMode(newMode) {
    this.mode = newMode;
  }

  toggleMode() {
    this.mode = this.mode === 'jaycee' ? 'facet' : 'jaycee';
    return this.mode;
  }

  /**
   * Draw the main shard panel texture
   */
  renderPanel(width, height, S) {
    const dpr = Math.max(window.devicePixelRatio || 1, 2.0);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);

    if (this.panelCanvas.width !== w || this.panelCanvas.height !== h) {
      this.panelCanvas.width = w;
      this.panelCanvas.height = h;
    }

    const ctx = this.panelCtx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padX = width * 0.082; // clean left margin

    // 1. Eyebrow: 11*S px, tracking 0.2em, 38% white, at 13.5% of height
    const eyebrowY = height * 0.135;
    const eyebrowSize = Math.max(11 * S, 11);
    ctx.font = `600 ${eyebrowSize}px 'Inter', sans-serif`;
    ctx.letterSpacing = '0.2em';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const eyebrowText = this.mode === 'jaycee'
      ? 'FREELANCE BACK-END DEVELOPER & SECURITY'
      : 'REAL-TIME MATERIAL STUDIO';
    ctx.fillText(eyebrowText, padX, eyebrowY);

    // 2. Headline: Inter 500, size min(7.8% of panel width, 20% of height), tracking -.045em, leading .97, #dcdce0 -> #bdbdc3 vertical gradient
    const headSize = Math.max(Math.min(width * 0.078, height * 0.20), 32);
    const leading = headSize * 0.97;
    const headY = eyebrowY + eyebrowSize + height * 0.045;

    ctx.font = `500 ${headSize}px 'Inter', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
    ctx.letterSpacing = '-0.045em';

    const line1 = this.mode === 'jaycee' ? 'Jaycee' : 'Designed';
    const line2 = this.mode === 'jaycee' ? '曾令强.' : 'in glass.';

    const headGrad = ctx.createLinearGradient(0, headY, 0, headY + leading * 2);
    headGrad.addColorStop(0, '#dcdce0');
    headGrad.addColorStop(1, '#bdbdc3');
    ctx.fillStyle = headGrad;

    ctx.fillText(line1, padX, headY);
    ctx.fillText(line2, padX, headY + leading);

    // 3. Two-line sub: 55% white
    const subY = headY + leading * 2 + height * 0.052;
    const subSize = Math.max(15 * S, 14);
    const subLeading = subSize * 1.52;
    ctx.font = `400 ${subSize}px 'Inter', sans-serif`;
    ctx.letterSpacing = '-0.01em';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';

    const subL1 = this.mode === 'jaycee'
      ? 'Building secure, resilient back-ends — and breaking them first. Live'
      : 'Author dispersion, transmission, and refraction in the browser. Live';
    const subL2 = this.mode === 'jaycee'
      ? 'previews, real systems, and a little magic in every line of code.'
      : 'previews, real materials.';

    ctx.fillText(subL1, padX, subY);
    ctx.fillText(subL2, padX, subY + subLeading);

    // 4. CTA Row: "Open studio" / "Say hello" light pill + "Read paper →" link
    const ctaY = subY + subLeading * 2 + height * 0.055;
    const btnW = 116 * S;
    const btnH = 40 * S;
    const btnRadius = 6 * S;

    // Save button hitbox
    this.hitboxes.button = { x: padX, y: ctaY, w: btnW, h: btnH };

    // Draw light pill button (turns green #36d67e on hover)
    ctx.fillStyle = this.isButtonHovered ? '#36d67e' : '#f0f0f4';
    this.roundRect(ctx, padX, ctaY, btnW, btnH, btnRadius);
    ctx.fill();

    // Button text
    ctx.font = `600 ${Math.max(13 * S, 12)}px 'Inter', sans-serif`;
    ctx.letterSpacing = '-0.01em';
    ctx.fillStyle = '#050507';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const btnText = this.mode === 'jaycee' ? 'Say hello' : 'Open studio';
    ctx.fillText(btnText, padX + btnW / 2, ctaY + btnH / 2);

    // 5. "Read paper →" / "Read story →" link (underlines on hover)
    const linkX = padX + btnW + Math.max(26 * S, 22);
    const linkSize = Math.max(14 * S, 13);
    ctx.font = `500 ${linkSize}px 'Inter', sans-serif`;
    ctx.letterSpacing = '-0.015em';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.isLinkHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';

    const linkText = this.mode === 'jaycee' ? 'Read story & paper →' : 'Read paper →';
    const linkMetrics = ctx.measureText(linkText);
    const linkW = linkMetrics.width;
    ctx.fillText(linkText, linkX, ctaY + btnH / 2);

    // Save link hitbox
    this.hitboxes.link = { x: linkX, y: ctaY, w: linkW, h: btnH };

    // Underline if hovered
    if (this.isLinkHovered) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(linkX, ctaY + btnH / 2 + linkSize * 0.58);
      ctx.lineTo(linkX + linkW, ctaY + btnH / 2 + linkSize * 0.58);
      ctx.stroke();
    }

    // 6. Bottom metadata: 11*S px at 34% white
    const botY = height - height * 0.075;
    ctx.font = `500 ${Math.max(11 * S, 11)}px 'Inter', sans-serif`;
    ctx.letterSpacing = '0.04em';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.textBaseline = 'bottom';

    const footLeft = this.mode === 'jaycee' ? '© Jaycee 曾令强' : '© Facet Lab';
    const footRight = this.mode === 'jaycee' ? 'Surabaya · Jember / Index 2026' : 'KHR_materials_dispersion';

    ctx.textAlign = 'left';
    ctx.fillText(footLeft, padX, botY);

    ctx.textAlign = 'right';
    ctx.fillText(footRight, width - padX, botY);

    ctx.restore();
    return this.panelCanvas;
  }

  /**
   * Draw the top nav slab texture
   */
  renderNav(width, height, S) {
    const dpr = Math.max(window.devicePixelRatio || 1, 2.0);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);

    if (this.navCanvas.width !== w || this.navCanvas.height !== h) {
      this.navCanvas.width = w;
      this.navCanvas.height = h;
    }

    const ctx = this.navCtx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padX = width * 0.055;
    const centerY = height * 0.5;

    // 1. Brand Mark: square mark + name
    const markSize = Math.max(24 * S, 22);
    const markX = padX;
    const markY = centerY - markSize / 2;

    // Square mark
    ctx.fillStyle = '#ffffff';
    this.roundRect(ctx, markX, markY, markSize, markSize, 4 * S);
    ctx.fill();

    // Mark monogram
    ctx.fillStyle = '#050507';
    ctx.font = `800 ${Math.max(11 * S, 11)}px 'Inter', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.mode === 'jaycee' ? 'JC' : 'F', markX + markSize / 2, centerY);

    // Brand Name
    const brandText = this.mode === 'jaycee' ? 'Jaycee' : 'Facet';
    ctx.font = `600 ${Math.max(15 * S, 14)}px 'Inter', sans-serif`;
    ctx.letterSpacing = '-0.02em';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(brandText, markX + markSize + 12 * S, centerY);

    // 2. Nav Links: 60% white, brighten on hover
    const links = this.mode === 'jaycee'
      ? ['Story', 'Experience', 'Education', 'Projects']
      : ['Studio', 'Materials', 'Pricing', 'Docs'];

    const navFontSize = Math.max(13 * S, 12);
    ctx.font = `500 ${navFontSize}px 'Inter', sans-serif`;
    ctx.letterSpacing = '-0.01em';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const itemSpacing = Math.max(38 * S, 32);
    const measured = links.map(label => ({
      label,
      w: ctx.measureText(label).width
    }));
    const totalW = measured.reduce((sum, item) => sum + item.w, 0) + (links.length - 1) * itemSpacing;
    let curX = (width - totalW) / 2;

    this.hitboxes.navLinks = [];
    measured.forEach((item, idx) => {
      const centerX = curX + item.w / 2;
      const isHovered = this.hoveredNavLinkIndex === idx;
      ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.60)';
      ctx.fillText(item.label, centerX, centerY);

      this.hitboxes.navLinks.push({
        label: item.label,
        x: curX - 8,
        y: centerY - 16,
        w: item.w + 16,
        h: 32
      });

      curX += item.w + itemSpacing;
    });

    // 3. Right Action: "Say hello" (or "Sign in")
    const actionText = this.mode === 'jaycee' ? 'Say hello' : 'Sign in';
    const actionSize = Math.max(13 * S, 12);
    ctx.font = `500 ${actionSize}px 'Inter', sans-serif`;
    ctx.letterSpacing = '-0.01em';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const actionX = width - padX;
    const actionMetrics = ctx.measureText(actionText);
    ctx.fillStyle = this.isNavContactHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(actionText, actionX, centerY);

    this.hitboxes.navContact = {
      x: actionX - actionMetrics.width,
      y: centerY - 15,
      w: actionMetrics.width,
      h: 30
    };

    ctx.restore();
    return this.navCanvas;
  }

  roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
