# Third-party notice — QLBS Kiosk

The standalone executable includes a native QR implementation adapted from:

- Manuel Bleichenbacher, **QR-Code-generator .NET, v1.6.0**:
  https://github.com/manuelbl/QrCodeGenerator/tree/v1.6.0
- Project Nayuki, **QR Code generator library**:
  https://www.nayuki.io/page/qr-code-generator-library

Adaptations: C# 5-compatible property/name syntax, a byte-mode UTF-8 factory,
removal of unused segmentation/bitmap/SVG APIs, and single-source embedding.
The matrix, Reed–Solomon and masking implementation retains the upstream logic.
A full notice is also embedded in the EXE's assembly copyright metadata.

```text
Copyright (c) Manuel Bleichenbacher (MIT License)
Copyright (c) Project Nayuki (MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

QLBS's own code remains subject to the repository's root LICENSE (MIT).
No external QR service is contacted; no image or token is sent to a third party.
