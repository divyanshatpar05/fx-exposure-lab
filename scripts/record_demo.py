"""Record docs/demo.gif: drive the running app with Chrome and capture a scripted tour.

Requires the dev servers (backend :8000, frontend :5173) and Google Chrome.
    pip install playwright pillow
    python scripts/record_demo.py
"""
import io
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
OUT = Path(__file__).resolve().parents[1] / "docs"
OUT.mkdir(exist_ok=True)
W, H = 1440, 900
GIF_W = 1000

frames: list[tuple[bytes, int]] = []


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)

        # Freeze the ticker tape so unchanged pixels can be reused between GIF frames.
        page.add_init_script("""document.addEventListener('DOMContentLoaded', () => {
            const s = document.createElement('style');
            s.textContent = '.tape-track{animation-play-state:paused!important} *{caret-color:transparent}';
            document.head.appendChild(s);
        });""")

        def shot(hold_ms):
            frames.append((page.screenshot(), hold_ms))

        def settle(ms=1600):
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(ms)

        def burst(n=3, gap=200, hold=1800):
            """Capture a transition (charts animating) then hold on the final frame."""
            for _ in range(n):
                page.wait_for_timeout(gap)
                shot(gap)
            settle(1400)
            shot(hold)

        def tab(name):
            page.get_by_role("button", name=name, exact=True).click()

        def click(name):
            page.get_by_role("button", name=name, exact=True).first.click()

        def scroll_to(y, steps=4):
            start = page.locator(".content").evaluate("el => el.scrollTop")
            for i in range(1, steps + 1):
                page.locator(".content").evaluate(f"el => el.scrollTop = {start + (y - start) * i / steps}")
                page.wait_for_timeout(60)
                shot(90)

        def scroll_to_el(selector_text, offset=90):
            y = page.locator(".content").evaluate(
                """(el, t) => {
                    const h = [...el.querySelectorAll('h3')].find(x => x.textContent.includes(t));
                    return h ? h.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : 0;
                }""",
                selector_text,
            )
            scroll_to(max(0, y - offset))

        # 1. Overview
        page.goto(f"{BASE}/#NKE/overview")
        settle(2600)
        shot(2600)

        # 2. Scenario Lab with presets
        tab("Scenario Lab")
        settle(900)
        shot(700)
        click("USD +10%")
        burst(hold=2200)
        click("EM crash")
        burst(hold=1800)
        click("Reset")
        settle(600)

        # 3. Hedging: apply a program, then show the frontier
        tab("Hedging")
        settle(1800)
        shot(900)
        click("Smart layered")
        burst(hold=2000)
        page.wait_for_selector(".recharts-scatter-symbol", timeout=20000)
        settle(600)
        scroll_to_el("efficiency frontier", offset=20)
        settle(500)
        shot(2400)

        # 4. Monte Carlo: hedged vs unhedged distributions
        tab("Monte Carlo")
        settle(400)
        burst(n=4, gap=220, hold=2800)

        # 5. Stress tests
        tab("Stress Tests")
        settle(1500)
        shot(1600)
        page.get_by_role("button", name="King Dollar 2022").click()
        burst(n=3, hold=1200)
        scroll_to_el("what drove the result", offset=150)
        settle(400)
        shot(2000)

        # 6. Rates & valuation, then the macro surface
        tab("Rates & Valuation")
        settle(1200)
        click("+200 bp")
        burst(hold=1800)
        scroll_to_el("Macro shock surface", offset=60)
        settle(400)
        shot(2400)

        # 7. Compare
        tab("Compare")
        settle(2600)
        shot(3000)

        # Static hero screenshot for the README
        tab("Monte Carlo")
        settle(2200)
        page.screenshot(path=str(OUT / "screenshot.png"))

        browser.close()


def build_gif():
    size = (GIF_W, round(GIF_W * H / W))
    rgb = [Image.open(io.BytesIO(png)).convert("RGB").resize(size, Image.LANCZOS) for png, _ in frames]
    durs = [ms for _, ms in frames]
    # One shared palette (built from a montage of every 3rd frame) keeps colours
    # stable across frames, so the encoder only stores the regions that change.
    sample = rgb
    montage = Image.new("RGB", (size[0], size[1] * len(sample)))
    for i, im in enumerate(sample):
        montage.paste(im, (0, i * size[1]))
    palette = montage.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    imgs = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in rgb]
    out = OUT / "demo.gif"
    imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=durs, loop=0, optimize=True, disposal=1)
    print(f"{len(imgs)} frames, {sum(durs) / 1000:.1f}s, {out.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    run()
    build_gif()
    sys.exit(0)
