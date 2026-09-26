# Third-Party Licenses

本文件列出了 Live2DPet Workspace 所使用的第三方开源组件及其许可证信息。

This file lists the third-party open-source components used by Live2DPet Workspace and their license information.

---

## 目录

- [Runtime Dependencies](#runtime-dependencies)
  - [Electron](#electron)
  - [@modelcontextprotocol/sdk](#modelcontextprotocolsdk)
  - [active-win](#active-win)
  - [electron-log](#electron-log)
  - [koffi](#koffi)
  - [zod](#zod)
- [Integrated Third-Party Software](#integrated-third-party-software)
  - [VOICEVOX Core](#voicevox-core)
  - [Live2D Cubism Core](#live2d-cubism-core)
- [免责声明](#免责声明)

---

## Runtime Dependencies

以下 npm 包作为运行时依赖被直接打包进应用。

### Electron

- **版本**: ^42.4.0
- **许可证**: MIT License
- **版权**: Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.
- **仓库**: https://github.com/electron/electron
- **说明**: 跨平台桌面应用框架，基于 Chromium 和 Node.js。

```
MIT License

Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### @modelcontextprotocol/sdk

- **版本**: ^1.30.0
- **许可证**: MIT License
- **版权**: Copyright (c) 2024 Anthropic, PBC
- **仓库**: https://github.com/modelcontextprotocol/typescript-sdk
- **说明**: Model Context Protocol 的官方 TypeScript SDK，用于 MCP 工具集成。

```
MIT License

Copyright (c) 2024 Anthropic, PBC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### active-win

- **版本**: ^8.2.1
- **许可证**: MIT License
- **版权**: Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
- **仓库**: https://github.com/sindresorhus/active-win
- **说明**: 获取当前活动窗口的元数据（标题、ID、边界、所属程序等）。

```
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### electron-log

- **版本**: ^5.4.3
- **许可证**: MIT License
- **版权**: Copyright (c) 2016 Alexey Prokhorov
- **仓库**: https://github.com/megahertz/electron-log
- **说明**: Electron 应用的日志记录模块。

```
MIT License

Copyright (c) 2016 Alexey Prokhorov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### koffi

- **版本**: ^2.15.1
- **许可证**: MIT License
- **版权**: Copyright (c) 2020 Niels Martignène
- **仓库**: https://github.com/Koromix/koffi
- **说明**: Node.js 的 C FFI（外部函数接口）模块，用于调用 VOICEVOX Core 的原生库。

```
MIT License

Copyright (c) 2020 Niels Martignène

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### zod

- **版本**: ^4.6.5
- **许可证**: MIT License
- **版权**: Copyright (c) 2020 Colin McDonnell
- **仓库**: https://github.com/colinhacks/zod
- **说明**: TypeScript 优先的 schema 验证库，用于 MCP 工具参数校验。

```
MIT License

Copyright (c) 2020 Colin McDonnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Integrated Third-Party Software

以下软件与 Live2DPet Workspace 集成使用，但不属于本项目的一部分，各自适用独立的许可协议。

### VOICEVOX Core

- **版本**: 0.16.3
- **许可证**: VOICEVOX ソフトウェア利用規約（自定义许可）
- **官网**: https://voicevox.hiroshiba.jp/
- **条款页面**: https://voicevox.hiroshiba.jp/term/
- **说明**: 日语文本转语音引擎，用于 TTS 语音合成。

**关键条款摘要**：

- 商用、非商用均可使用。
- 使用生成的音频时，须遵守各音声库的利用规约。
- 使用时需以 `VOICEVOX: 角色名` 的形式标注信用。
- 禁止未经授权再分发本软件的全部或部分。
- 禁止逆向工程、反编译或公开其方法。

**本项目的合规声明**：本应用使用 VOICEVOX 生成语音，所有语音输出均标注 `VOICEVOX: 角色名`。VOICEVOX Core 的文件不随本项目分发，用户需自行从官方网站获取。

### Live2D Cubism Core

- **版本**: Cubism 4（由用户自行提供）
- **许可证**: Live2D Proprietary Software License Agreement（专有许可）
- **官网**: https://www.live2d.com/
- **许可协议**: https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html
- **说明**: Live2D 模型的渲染引擎，用于在桌面上显示 Live2D 角色。

**关键条款摘要**：

- 核心库文件（`live2dcubismcore.min.js` 等）禁止二次分发。
- 禁止逆向工程或反向编译核心库。
- 发布使用 Cubism SDK 开发的“可扩展应用程序”需另行申请出版许可。
- 年收入超过 1000 万日元（约 50 万人民币）的实体需签订出版许可协议。

**本项目的合规声明**：本项目**不包含** `live2dcubismcore.min.js` 或 `cubism4.min.js`。用户需自行从 Live2D 官网下载 SDK 并同意其许可协议后，将核心文件放入 `libs/` 目录。`libs/` 目录下的 Live2D 核心文件已被 `.gitignore` 排除，不会随源码仓库分发。

---

## 间接依赖

本项目通过 `node_modules` 引入了大量间接依赖（传递依赖）。这些依赖的许可证信息可在各自包的 `LICENSE` 文件中找到，或通过以下命令查看：

```bash
npx license-checker --summary
```

如需生成完整的依赖许可证报告，可运行：

```bash
npx license-checker --json > licenses.json
```

---

## 免责声明

本文件仅用于开源合规目的，列出项目使用的第三方组件及其许可证信息。各许可证的具体条款以各项目官方发布的许可证文本为准。如有遗漏或错误，欢迎提交 Issue 指正。

---

*最后更新：2026-09-26*