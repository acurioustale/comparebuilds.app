<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

// Load the OG image endpoint's pure helpers (font discovery + hex parsing)
// without running the request handler. The OG_API_NO_MAIN guard in og.php returns
// before reading the request, opening a DB connection, or emitting an image, so
// no config.php, database, or GET parameter is needed.
define('OG_API_NO_MAIN', true);
require_once __DIR__ . '/../api/og.php';

/**
 * Covers og.php's pure helpers — the parts most likely to silently regress
 * (a missing bundled font, or a hex-colour parse going wrong on the share card).
 */
final class OgRenderTest extends TestCase
{
    public function testFindFontReturnsBundledFont(): void
    {
        $font = find_font();
        $this->assertNotNull($font, 'a bundled bold TTF should always be found');
        $this->assertSame('DejaVuSans-Bold.ttf', basename($font));
        $this->assertFileExists($font);
    }

    public function testHexcolorParsesValidHex(): void
    {
        if (!function_exists('imagecreatetruecolor')) {
            $this->markTestSkipped('GD not available');
        }
        $img = imagecreatetruecolor(1, 1);
        $rgb = imagecolorsforindex($img, hexcolor($img, '#ff8000'));
        $this->assertSame(255, $rgb['red']);
        $this->assertSame(128, $rgb['green']);
        $this->assertSame(0, $rgb['blue']);
    }

    public function testHexcolorFallsBackOnMalformedHex(): void
    {
        if (!function_exists('imagecreatetruecolor')) {
            $this->markTestSkipped('GD not available');
        }
        $img = imagecreatetruecolor(1, 1);
        // Not six hex digits → falls back to the gold accent #c8a84b.
        $rgb = imagecolorsforindex($img, hexcolor($img, 'nope'));
        $this->assertSame(0xC8, $rgb['red']);
        $this->assertSame(0xA8, $rgb['green']);
        $this->assertSame(0x4B, $rgb['blue']);
    }
}
