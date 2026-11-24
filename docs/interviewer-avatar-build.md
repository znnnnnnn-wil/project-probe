# 面试官人物资产复建

当前人物为仓库内的 `frontend/public/models/interviewer-v2.glb`，基于 HumanForge v0.5.0 的 MakeHuman / MPFB CC0 素材生成。皮肤、短发、深灰职业西装和深棕虹膜均来自该素材包。人物配置保存在 `scripts/interviewer-avatar.entry.ts`，主页面里的眼镜、灯光和动态表情由前端运行时附加。

`frontend/public/models/interviewer-v2-portrait.webp` 为同一人物在当前渲染器中的静态截图，用于加载中和 WebGL 不可用时的回退，避免切换成另一张人物照片。更新造型时应同步更新该肖像。

## 固定素材版本

- SDK：<https://github.com/abdulrehman043/humanforge>
- 固定提交：`b3e5885ade1b3d48e12994a121e33e07e806390b`
- SDK 版本：`0.5.0`
- 该提交已包含 `assets/human` 素材包，无需重新烘焙 MakeHuman 数据。
- 原始许可见 SDK 的 `LICENSE` 和 `LICENSE.ASSETS.md`。

首次复建时，将 SDK 放在忽略目录 `.runtime/humanforge`：

```powershell
git clone https://github.com/abdulrehman043/humanforge.git .runtime/humanforge
git -C .runtime/humanforge checkout b3e5885ade1b3d48e12994a121e33e07e806390b
npm --prefix frontend ci
node scripts/build-interviewer-avatar.mjs
```

脚本需要本机 Microsoft Edge，通过 Playwright 无头启动，临时监听 `127.0.0.1:5281`，完成后关闭；不会使用正在运行的 5273 前端服务。通过 `HUMANFORGE_ROOT` 可指定其他 SDK 目录。命令的第一个参数可指定输出路径，例如 `node scripts/build-interviewer-avatar.mjs .runtime/rebuilt-interviewer.glb`，方便在替换正式资产前比较。

## 当前造型与数据

`short02` 短发，`male_elegantsuit01` 深灰西装，`middleage_asian_male` 皮肤，`brown` 深棕虹膜。配置包含年龄、体型和少量脸型修整；年龄滑块是几何插值参数，不代表人物真实年龄。

导出保留身体上全部 34 个非零表情及相关眉毛、睫毛和口腔变形，使用 `mouthSmile`、`mouthPucker`、`mouthPress` 等素材原生名称。该素材没有完整 52 项 ARKit 表情，也没有音素 `viseme_*`；不能据此宣称精确中文音素同步。

`scripts/sparsify-avatar-glb.mjs` 把面部变形中的零顶点改为 glTF 2.0 标准 sparse accessor，逐字节比对解码后的 57 组 morph 数据和其他缓冲区，保持几何、材质贴图及表情数值一致。无需 Draco、Meshopt 或 `KHR_mesh_quantization`。最终模型约 3.90 MB；不同浏览器版本可能使内嵌 JPEG 编码及文件哈希略有变化。

头发保留 alpha mask 核心层，省略易发生排序问题的透明发梢副本。运行时应保留头发 `MASK` 模式及约 0.42 的透明度阈值，避免统一改成低阈值透明混合后再现灰白发片。
