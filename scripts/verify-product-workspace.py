import json

from playwright.sync_api import sync_playwright


def verify_page(page, width, height, screenshot_path):
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.set_viewport_size({"width": width, "height": height})
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")
    page.get_by_text("产品生图工作台", exact=True).wait_for()
    page.get_by_text("上传产品参考图", exact=True).wait_for()
    page.get_by_text("提示词模板", exact=True).wait_for()
    page.get_by_text("创作引导", exact=True).wait_for()
    assert page.locator("body").evaluate("el => el.scrollWidth <= window.innerWidth + 1")
    page.screenshot(path=screenshot_path, full_page=True)
    assert errors == [], errors


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    desktop = browser.new_page()
    desktop.add_init_script("localStorage.setItem('yunwu_api_key', 'test-key')")

    def mock_yunwu(route):
        if "gemini-3-pro-preview" in route.request.url:
            body = {
                "candidates": [{
                    "content": {
                        "parts": [{"text": '["窗边自然光产品特写", "户外野餐桌面场景", "人物手持产品近景"]'}]
                    }
                }]
            }
        else:
            body = {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "inlineData": {
                                "mimeType": "image/png",
                                "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
                            }
                        }]
                    }
                }]
            }
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    desktop.route("https://yunwu.ai/**", mock_yunwu)
    verify_page(desktop, 1440, 960, "/tmp/product-studio-desktop.png")
    desktop.get_by_role("button", name="API 连接").click()
    desktop.get_by_text("服务商连接", exact=True).wait_for()
    desktop.get_by_text("服务器已配置", exact=True).wait_for()
    desktop.get_by_role("button", name="取消").click()

    desktop.locator('input[type="file"]').set_input_files(
        "/var/folders/gl/04kt1bt13yx4kwr8jckvbw0m0000gn/T/codex-clipboard-e901abd6-e133-4d7e-9bff-ac58a2e0f125.png"
    )
    desktop.get_by_label("提示词模板").fill("保持产品包装、颜色、Logo 和文字完全一致")
    desktop.get_by_label("创作引导").fill("自然光商业摄影，变化场景、构图和人物互动")
    desktop.get_by_role("button", name="生成 12 条提示词").click()
    desktop.get_by_text("确认后再产生图片费用", exact=True).wait_for()
    assert desktop.locator(".prompt-row").count() == 3
    desktop.screenshot(path="/tmp/product-studio-review.png", full_page=True)

    selected_buttons = desktop.get_by_role("button", name="取消选择")
    selected_buttons.nth(2).click()
    selected_buttons.nth(1).click()
    desktop.get_by_role("button", name="生成已选 1 张").click()
    desktop.locator(".result-item img").wait_for(timeout=25000)
    assert desktop.locator(".result-item").count() == 1
    desktop.screenshot(path="/tmp/product-studio-results.png", full_page=True)

    mobile = browser.new_page()
    verify_page(mobile, 390, 844, "/tmp/product-studio-mobile.png")
    browser.close()

print("workspace verification passed")
