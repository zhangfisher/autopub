# 概述

`FlexPub`是一个`monorepo`工程的一健自动发包工具。

本工具是在开发[VoerkaI18n](https://zhangfisher.github.io/voerka-i18n/)解决方案（非常不错的多语言解决方案）时的副产品，`voerkai18n`是一个标准的`monorepo`包=工程，包含了`@voerkai18n/cli`、`@voerkai18n/runtime`、`@voerkai18n/utils`、`@voerkai18n/vue`、`@voerkai18n/vite`、`@voerkai18n/babel`、`@voerkai18n/react`、`@voerkai18n/formatters`等多个包，发布包时容易引起混乱问题,主要问题：

- 经常忘记哪个包最近什么时间修改，哪个包应该发布。
- 由于包之间存在依赖关系，需要按一定的顺序进行发布
- 使用`git hooks`来进行自动发布不能满足要求，因为并不是每一次提交均需要发包.

`FlexPub`可以自动一键发布自最近一次发包以来有修改过的包，整个发包过程可以实现全自动。
 

# 指南

**注意：**本工具在`pnpm/monorepo`环境下测试通过，不适用于`lerna/yarn`等`monorepo`工程。

## 第一步：安装

一般建议安装在全局，也可以安装在当前工作区。

```javascript
> pnpm add -g autopub
> npm install -g autopub
> yarn global add autopub
```

## 第二步：注入发包脚本

接下来可以调用`autopub init`来为当前工作区注入必要的脚本。
```shell
> autopub init
```
- **`autopub init`命令会在工作区的`package.json`注入脚本**
```json
// package.json
{
   "publish:mock":"pnpm autopub --all --no-ask --dry-run",
   "publish:all":"pnpm autopub --all",
   "publish:auto":"pnpm autopub --all --no-ask",
   "publish:auto:beta":"pnpm autopub --all --no-ask --dist-tag beta"
}
```
- **`autopub init`命令在当前工作区`packages`下的所有包的`package.json`注入脚本**

```json
// package.json
{
   "release":"pnpm autopub" 
}
```


## 第三步：

`@voerkai18n/autopublish`用于采用`pnpmp`创建的`monorepo`包工程，不支持`lerna/yarn`。
按照常规约定，包存放在`<projectRoot>/packages/<name>`。

## 第一步：配置包的发布脚本

将`@voerkai18n/autopublish`添加为包的开发依赖。

```javascript
// 进入包文件夹后执行
> pnpm add -D @voerkai18n/autopublish
```
然后，配置发布脚本:
```json
{
    "scripts":{
        "build":"默认的包构建命令",
        "release":"pnpm autopub"
    },
    "devDependencies": {
        "autopub": "^1.0.0"
    }
}
```

- 发布脚本必须为`release`，不能是其他名称，特别是`publish`
- `pnpm autopublish`也可以在包路径下单独执行。
- `pnpm autopublish`默认依次执行:
    - `npm version patch`：升级版本号
    - `pnpm run build`(可选)
    - `pnpm publish --no-git-checks --access publish`
- 默认每次发布均会升级`patch`版本号，可以通过`pnpm autopublish -i <版本递增方式>`来增加版本号，递增方式可选：[`"major"`, `"minor"`, `"patch"`,`"premajor"`,`"preminor"`,`"prepatch"`,`"prerelease"`]
- 每次执行`pnpm autopublish`均会在当前包的`package.json`中添加`lastPublish`字段，用来记录发布的时间。这是下一次发布时进行自动比对发布的依据。


## 第二步：配置工作区发布脚本

在当前工程的根文件夹下配置`package.json`
```json
{
    "scripts":{
        "list:package": "node ./packages/autopublish/index.js list",
        "autopublish": "node ./packages/autopublish/index.js"
    },
    "devDependencies": {
        "@voerkai18n/autopublish": "workspace:^1.0.0"
    }
}
```
## 第三步：自动发布所有包

```javascript
> pnpm autopublish -- -a -n
```

`pnpm autopublish`会自动枚举出当前所有包，然后对比包路径`packages/<包名>`最后修改时间和`package.json`的`lastPublish`字段值，如果：
- 最后修改时间大于最后发布时间，则发布该包
- 最后修改时间关于或者小于最后发布时间，则忽略发布该包

因此，每次当修改完工程后，可以自动执行`pnpm autopublish -- -a -n`就可以进行全自动发布。

`pnpm autopublish`命令行参数:
```shell
自动发布包

Options:
  -a, --all                             发布所有包
  -n, --no-ask                          不询问
  -s, --no-silent                       静默显示脚本输出
  -i, --version-increment-step [value]  版本增长方式 (choices: "major", "minor", "patch", "premajor", "preminor", "prepatch",
                                        "prerelease", default: "patch")
  -h, --help                            display help for command

Commands:
  list                                  列出各个包的最后一次提交时间和版本信息
```

- `-a`代表要发布所有包，如果没有启用`-n`，则会让用户选择要发布哪一个包。如果启用`-n`参数，则会全自动比对发布时间和修改时间后发布。
- `-no-ask`代表不会询问让用户选择要发布的包.
- `--no-silent`代表是否不输出脚本输出。
- 由于包之间存在依赖关系，`autopublish`会根据依赖关系进行排序发布和关联发布。比如`@voerkai18n/cli`依赖于`@voerkai18n/utils`，当`@voerkai18n/utils`有更新需要发布时，`@voerkai18n/cli`也会自动发布。


## 第四步: 手动选择发布

`pnpm autopublish -- -a -n`会根据发布时间和修改时间进行自动发布。也支持手动选择要发布的包。
```javascript
> pnpm autopublish -- -a 
````
如果不启用`-n`参数，则会列出当前工作区的所有包，让用户选择要发布的包。

## 列出包

`pnpm autopublish -- list`列出当前工程的所有包，并显示当前包最近更新和最近发布时间。