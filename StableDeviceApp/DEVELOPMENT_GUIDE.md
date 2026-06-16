# 开发指南

## 环境搭建

### 1. 安装依赖

```bash
# 安装项目依赖
npm install

# 安装Expo CLI（如果尚未安装）
npm install -g expo-cli
```

### 2. 启动开发服务器

```bash
# 启动Expo开发服务器
npx expo start

# 在Android模拟器中运行
npx expo run:android

# 在iOS模拟器中运行
npx expo run:ios

# 在Web浏览器中运行
npx expo start --web
```

### 3. 开发工具推荐

- **IDE**：Visual Studio Code
- **插件**：
  - ESLint
  - Prettier
  - React Native Tools
  - TypeScript

## 代码规范

### 1. ESLint和Prettier

- 运行 `npm run lint` 检查代码风格
- 运行 `npx eslint --fix` 自动修复代码风格问题
- 运行 `npx prettier --write .` 格式化代码

### 2. TypeScript

- 运行 `npm run typecheck` 检查TypeScript类型
- 为函数参数和返回值添加类型注解
- 为复杂数据结构定义接口
- 避免使用 `any` 类型

### 3. 命名约定

- **组件**：大驼峰命名法（PascalCase）
- **函数**：小驼峰命名法（camelCase）
- **变量**：小驼峰命名法（camelCase）
- **常量**：全大写命名法（SNAKE_CASE）
- **文件**：小驼峰命名法（camelCase）

### 4. 代码风格

- 使用2个空格缩进
- 使用单引号
- 每行不超过80个字符
- 适当使用空行分隔代码块
- 添加清晰的注释

## 开发流程

### 1. 新增功能

1. **创建分支**：从主分支创建新的功能分支
2. **实现功能**：编写代码实现功能
3. **测试**：运行测试确保功能正常
4. **代码审查**：提交代码审查请求
5. **合并**：代码审查通过后合并到主分支

### 2. 修复bug

1. **创建分支**：从主分支创建新的bug修复分支
2. **定位问题**：找到并理解bug的原因
3. **修复**：编写代码修复bug
4. **测试**：运行测试确保bug已修复
5. **代码审查**：提交代码审查请求
6. **合并**：代码审查通过后合并到主分支

### 3. 代码审查

- 遵循 `CODE_REVIEW.md` 中的审查流程
- 确保代码符合ESLint和Prettier规范
- 确保TypeScript类型定义正确
- 确保代码逻辑正确，无潜在bug
- 确保代码可维护性良好

## 项目结构

### 1. 目录结构

```
StableDeviceApp/
├── src/
│   ├── components/         # 可复用组件
│   ├── navigation/         # 导航配置
│   ├── screens/            # 页面组件
│   ├── services/           # 服务层
│   └── utils/              # 工具函数
├── App.tsx                 # 应用入口
├── package.json            # 依赖配置
├── tsconfig.json           # TypeScript配置
└── README.md               # 项目文档
```

### 2. 核心模块

- **导航系统**：`src/navigation/`
- **页面组件**：`src/screens/`
- **服务层**：`src/services/`
- **工具函数**：`src/utils/`
- **可复用组件**：`src/components/`

## 常用命令

### 1. 开发命令

```bash
# 启动开发服务器
npx expo start

# 运行Android
npx expo run:android

# 运行iOS
npx expo run:ios

# 运行Web
npx expo start --web
```

### 2. 代码质量命令

```bash
# 检查代码风格
npm run lint

# 自动修复代码风格
npx eslint --fix

# 格式化代码
npx prettier --write .

# 检查TypeScript类型
npm run typecheck
```

### 3. 构建命令

```bash
# 构建Android
npx expo build:android

# 构建iOS
npx expo build:ios

# 构建Web
npx expo export --platform web
```

## 常见问题

### 1. 依赖问题

- **问题**：依赖安装失败
- **解决方案**：删除 `node_modules` 和 `package-lock.json`，重新运行 `npm install`

### 2. 启动问题

- **问题**：Expo开发服务器启动失败
- **解决方案**：确保端口8081未被占用，或使用 `npx expo start --port 8082` 指定其他端口

### 3. 类型错误

- **问题**：TypeScript类型错误
- **解决方案**：添加正确的类型注解或类型定义，避免使用 `any` 类型

### 4. 代码风格问题

- **问题**：ESLint错误
- **解决方案**：运行 `npx eslint --fix` 自动修复，或手动修改代码

### 5. 蓝牙连接问题

- **问题**：蓝牙设备连接失败
- **解决方案**：确保设备蓝牙已开启，应用已获得蓝牙权限，设备在可发现状态

## 调试技巧

### 1. React Native Debugger

- 安装 React Native Debugger
- 运行 `npx expo start`
- 按 `d` 打开开发者菜单
- 选择 "Debug Remote JS"

### 2. Console Logs

- 使用 `console.log()` 打印调试信息
- 在Expo开发服务器的控制台查看日志

### 3. React DevTools

- 安装 React DevTools
- 运行 `npx react-devtools`
- 在应用中查看组件层次和状态

## 发布流程

### 1. 构建应用

```bash
# 构建Android APK
npx expo build:android

# 构建iOS IPA
npx expo build:ios

# 构建Web版本
npx expo export --platform web
```

### 2. 发布到应用商店

- **Android**：上传APK到Google Play Console
- **iOS**：上传IPA到App Store Connect
- **Web**：部署到静态网站托管服务

## 最佳实践

### 1. 组件设计

- 保持组件小而专注
- 使用props传递数据和回调函数
- 使用useState和useEffect管理状态和副作用
- 使用useMemo和useCallback优化性能

### 2. 服务层设计

- 将业务逻辑封装在服务中
- 提供清晰的API接口
- 处理错误和异常
- 实现缓存机制提高性能

### 3. 工具函数设计

- 将通用功能提取为工具函数
- 保持工具函数独立和可测试
- 添加适当的类型注解
- 编写清晰的文档

### 4. 测试

- 为核心功能编写单元测试
- 测试边界情况和错误处理
- 使用Jest和React Testing Library
- 确保测试覆盖率达到合理水平

## 资源和文档

- **React Native文档**：https://reactnative.dev/docs/getting-started
- **Expo文档**：https://docs.expo.dev/
- **React Navigation文档**：https://reactnavigation.org/docs/getting-started
- **TypeScript文档**：https://www.typescriptlang.org/docs/
- **ESLint文档**：https://eslint.org/docs/user-guide/getting-started
- **Prettier文档**：https://prettier.io/docs/en/index.html
