import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const HTML_FILE = process.argv[2] ?? "cv.html";
const PDF_FILE = process.argv[3] ?? "cv.pdf";

// Render at 3x resolution for a sharp CV.
const SCALE = 3;

// A4 dimensions in CSS pixels at 96 DPI.
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

// A4 dimensions in PDF points.
const A4_WIDTH_PT = 595.276;
const A4_HEIGHT_PT = 841.89;

async function main() {
    const htmlPath = path.resolve(HTML_FILE);
    const pdfPath = path.resolve(PDF_FILE);

    console.log("=================================");
    console.log("HTML → IMAGE → PDF");
    console.log("=================================");
    console.log("HTML:", htmlPath);
    console.log("PDF:", pdfPath);
    console.log("");

    if (!fs.existsSync(htmlPath)) {
        throw new Error(`HTML file does not exist: ${htmlPath}`);
    }

    const browser = await chromium.launch({
        headless: true,
    });

    try {
        /*
         * -------------------------------------------------------
         * BROWSER
         * -------------------------------------------------------
         */

        const page = await browser.newPage({
            viewport: {
                width: A4_WIDTH_PX,
                height: A4_HEIGHT_PX,
            },

            deviceScaleFactor: SCALE,
        });

        /*
         * Load the HTML normally.
         *
         * We deliberately DO NOT use page.pdf().
         */
        await page.goto(pathToFileURL(htmlPath).href, {
            waitUntil: "networkidle",
        });

        /*
         * Wait for fonts.
         */
        await page.evaluate(async () => {
            if (document.fonts) {
                await document.fonts.ready;
            }
        });

        /*
         * Wait for everything to paint.
         */
        await page.waitForTimeout(1000);

        /*
         * -------------------------------------------------------
         * NORMALISE THE CV FOR SCREENSHOT
         * -------------------------------------------------------
         *
         * We don't use Chromium's print engine at all.
         *
         * The .page element itself is captured.
         */

        const sheet = page.locator("#sheet, .page, .sheet").first();

        if (await sheet.count() === 0) {
            throw new Error(
                "Could not find the CV sheet. Expected #sheet, .page or .sheet."
            );
        }

        await page.evaluate(() => {
            const sheet =
                document.getElementById("sheet") ??
                document.querySelector<HTMLElement>(".page, .sheet");

            if (!sheet) {
                throw new Error("CV sheet not found.");
            }

            /*
             * Force exactly A4 dimensions.
             */
            sheet.style.width = "210mm";
            sheet.style.height = "297mm";
            sheet.style.minHeight = "297mm";
            sheet.style.maxHeight = "297mm";

            /*
             * Remove the screen preview margin/shadow.
             */
            sheet.style.margin = "0";
            sheet.style.boxShadow = "none";

            /*
             * Make sure the body cannot interfere with
             * the screenshot.
             */
            document.documentElement.style.margin = "0";
            document.documentElement.style.padding = "0";

            document.body.style.margin = "0";
            document.body.style.padding = "0";
            document.body.style.background = "#ffffff";
        });

        /*
         * Force the browser to recalculate layout.
         */
        await page.evaluate(() => {
            document.body.offsetHeight;
        });

        await page.waitForTimeout(300);

        /*
         * -------------------------------------------------------
         * SCREENSHOT
         * -------------------------------------------------------
         */

        const screenshotPath = path.join(
            process.cwd(),
            ".cv-render.png"
        );

        console.log("Rendering CV at 3x resolution...");

        await sheet.screenshot({
            path: screenshotPath,
            type: "png",
            animations: "disabled",
        });

        console.log("Screenshot created.");

        /*
         * -------------------------------------------------------
         * CREATE PDF
         * -------------------------------------------------------
         */

        console.log("Creating A4 PDF...");

        const imageBytes = fs.readFileSync(screenshotPath);

        const pdf = await PDFDocument.create();

        const pdfPage = pdf.addPage([
            A4_WIDTH_PT,
            A4_HEIGHT_PT,
        ]);

        const image = await pdf.embedPng(imageBytes);

        /*
         * Fill the entire A4 page.
         *
         * No browser PDF renderer is involved here.
         */
        pdfPage.drawImage(image, {
            x: 0,
            y: 0,
            width: A4_WIDTH_PT,
            height: A4_HEIGHT_PT,
        });

        /*
         * Save.
         */
        const pdfBytes = await pdf.save();

        fs.writeFileSync(pdfPath, pdfBytes);

        /*
         * Delete temporary PNG.
         */
        try {
            fs.unlinkSync(screenshotPath);
        } catch {
            // Ignore cleanup failure.
        }

        console.log("");
        console.log("=================================");
        console.log("PDF CREATED SUCCESSFULLY");
        console.log("=================================");
        console.log("Output:", pdfPath);
        console.log("");
        console.log("Chromium PDF renderer was NOT used.");
        console.log("The PDF is an A4 image of the rendered CV.");

    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error("");
    console.error("=================================");
    console.error("PDF GENERATION FAILED");
    console.error("=================================");
    console.error(error);
    process.exit(1);
});