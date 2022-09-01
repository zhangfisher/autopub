# 概述

`AutoPub`是一个`pnpm/monorepo`QQ问你工程的一健自动发包工具。

本工具是在开发[VoerkaI18n](https://zhangfisher.github.io/voerka-i18n/)解决方案（非常不错的多语言解决方案）时的副产品，`voerkai18n`是一个标准的`monorepo`工程，包含了`@voerkai18n/cli`、`@voerkai18n/runtime`、`@voerkai18n/utils`、`@voerkai18n/vue`、`@voerkai18n/vite`、`@voerkai18n/babel`、`@voerkai18n/react`、`@voerkai18n/formatters`等多个包，发布包时容易引起混乱问题，主要问题：

- 经常忘记哪个包最近什么时间修改，哪个包应该发布，没办法，记性不好。
- 由于包之间存在依赖关系，需要按一定的顺序进行发布
- 使用`git hooks`来进行自动发布不能满足要求，因为并不是每一次提交均需要发包.

`AutoPub`可以自动一键发布自最近一次发包以来有修改过的包，整个发包过程可以实现全自动。
 
有了`AutoPub`，发布时，只需要执行`pnpm autopub`，妈妈再也不担心我的发包了。

# 快速入门

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

```javascript
// package.json
{
    "scripts":{
        "publish:mock":"pnpm autopub --all --no-ask --dry-run",
        "publish:auto":"pnpm autopub --all --no-ask", 
        "publish:all":"pnpm autopub --all",  
        "publish:[包名称]":"pnpm autopub --package [包名称]",    
        "publish:[包名称]":"pnpm autopub --package [包名称]",    
    }
}

``` 

| 命令 |  说明 |
| :---: | ---- |
| `publish:mock` | 用来模拟发布，也就是调用了`pnpm publish --dry-run`,执行完整的发包流程，但是没有实际发布到`NPM Registry`。|
| `publish:auto` | 全程自动化发包，一键发布自最近一次发包以来有修改过的包,不需要人工介入,平时主要使用该命令 |
| `publish:all` | 交互式发布，可以交互选择要发布的包等参数 |
| `publish:[包名称]` | 每个包对应一个单独发布包的命令 |
 


**注：**
`publish:mock`、`publish:auto`、`publish:all`仅是默认注入的发包命令，您也可以自己根据`autopub`命令行参数自己编写发包命令，比如编写`publish:beta`之类发布带有`distTag`的包，参见后面命令行参数介绍。
     

- **`autopub init`命令在当前工作区`packages`下的所有包的`package.json`注入脚本**

在当前工作区`packages`下的所有包均需要使用`autopub`来发布，当执行`publish:auto`时会依次调用各包中的`release`脚本来发布。

```javascript
// package.json
{
   "scripts":{
        "release":"pnpm autopub" 
   }
}
```
## 第三步：自动发布

当配置好以上发包脚本后，在需要发布时就可以直接调用相应的脚本命令来发包了。

- **一键自动化发包**

一键发布自最近一次发包以来有修改过的包,不需要人工介入,整个过程全自动完成，这是平时享受发包快感的主要来源。

在开发`VoerkaI18n`时，当修改了源码，提交了N次后，需要发包时，就来一发，那爽劲不可描述。
```javascript
> pnpm publish:auto
```

- **发布指定包**

`voerkai18n`共有8个包，执行`autopub init`后，会在工作区package.json注入对应包的发包脚本。如下：

```javascript
// package.json
{
    "scripts":{ 
        ...   
        "publish:cli":"pnpm autopub --package cli",    
        "publish:runtime":"pnpm autopub --package runtime",   
        "publish:formatters":"pnpm autopub --package formatters",   
        "publish:vue":"pnpm autopub --package vue",  
        "publish:react":"pnpm autopub --package react",  
        "publish:babel":"pnpm autopub --package babel",  
        "publish:vite":"pnpm autopub --package vite",  
        "publish:utils":"pnpm autopub --package utils",  
    }
}

``` 

当想发布指定包时，只需要执行`publish:<包名称>`即可，如下：

```javascript
> pnpm publish:cli
> pnpm publish:runtime
```

# 指南

## 命令行

`autopub`命令行参数如下：

```shell

一健自动发包工具

Options:
  -a， --all                             发布所有包
  -n， --no-ask                          不询问
  -s， --no-silent                       静默显示脚本输出
  -p， --package                         指定要发布的包
  -d， --dry-run                         模拟发布
  -t,  --dist-tag <value>                 发布标签
  -i， --version-increment-step [value]  版本自动增长方式，default:patch
  -e, --excludes                         排除要发布的包
  -f, --force                            强制发布包
  -h， --help                            display help for command

Commands:
  list                                  列出各个包的最后一次提交时间和版本信息

```

## 自动发布

当启用`-a`、`--no-ask`参数时，代表不会询问让用户选择要发布的包，全程自动化发包，会根据比对最近一次发布时间和工程文件夹中最近修改时间来自动发布。


## 交互式发包
当没有启用`--no-ask`时,代表不会询问让用户选择要发布的包，版本自动增长方式，发布标签等参数。

- `--no-silent`代表是否不输出脚本输出。

## 发包顺序

由于包之间存在依赖关系，`autopub`会根据依赖关系进行排序发布和关联发布。比如`@voerkai18n/cli`依赖于`@voerkai18n/utils`，当`@voerkai18n/utils`有更新需要发布时，`@voerkai18n/cli`也会自动发布。

## 版本自动增长方式

默认情况下，发包时均会升级`patch`版本号，可以通过`-i`参数来修改递增版本号。

```shell
> pnpm public:auto -i <major | minor | patch | premajor | preminor | prepatch | prerelease>
> pnpm autopub -i <major | minor | patch | premajor | preminor | prepatch | prerelease>
```

如果您要修改默认的版本自动增长方式,可以修改工作区`package.json`，如下：

```javascript
{
    "scripts":{
         "publish:auto":"pnpm autopub --all --no-ask -i minor",  // 每次发包均递增minor
    }
}
```


## 模拟发布

启用`-d, --dry-run`参数可以进行模拟发布，该参数会导致走完整个发包流程，但是没有实际发布到`NPM`。
该参数主要用于测试。
## 排除要发布的包

在`packages`文件夹下的包，有些是测试应用等，并不需要进行发包，此时就需要配置需要排除哪些要发布的包，方法如下：

- 在命令行中传入`-e, --excludes`参数

```javascript
> pnpm autopub -e utils apps  // 代表utils和apps两个包不发布
```

也可以在当前工作区`package.json`中配置：

```javascript
{
    autopub:{
        excludes:["utils","apps"]
    }
}
```

## 发布报告

当执行完自动发包会生成一份当前工作区的所有包的简单发布信息，目前支持两种格式：

- **MarkDown**

样式可以参见[这里](https://zhangfisher.github.io/voerka-i18n/guide/intro/versions)

- **JSON**

```javascript
{
    "包名称":{
        version:"<最新版本号>",
        lastPublish:"<最近发布时间>",
        description:"<包描述，即该package.json中描述>"
    }
}
```

发布报告默认生成在当前工作区下，文件名是`versions.md`，如果要更改文件名称或生位置，需要修改当前工作区`package.json`中配置。

```javascript
{
    "autopub":{
        "report": "versions.md",                 // <当前工作区>/versions.md
        "report": "versions.json",               // <当前工作区>/versions.josn
        "report": "docs/versions.md",            // <当前工作区>/docs/versions.md
        "report": "docs/versions.json",          //<当前工作区>/docs/versions.json
    }
}
```

- 发布报告可以用来自动更新到项目文档中，效果见[这里](https://zhangfisher.github.io/voerka-i18n/guide/intro/versions)
- 当前发布报告还比较简单，后续考虑增加`CHANGELOGS`。

## 单独包发布

默认情况下，工作区下所有包的`package.json`中均需要增加了`release`的脚本命令。
```javascript
// package.json
{
   "scripts":{
        "release":"pnpm autopub" 
   }
}
```

各个包下的`release`的脚本命令在执行`pnpm autopub -a --no-ask`时会均被调用执行。
因此，如果您可以修改该脚本，在发布时干点什么，比如：
```javascript
// package.json
{
   "scripts":{
        "release":"<xxxx> && pnpm autopub" 
   }
}
```
默认情况下， `autopub`会采用静默输出方式，脚本执行时的过程信息不会被显示出来，这样当出错时显示的信息可能不够详尽，您可以使用`--no-silent`参数来输出执行过程信息,这样当出错时就可以得到更加详细的信息。

```javascript
> pnpm publish:auto --no-silent
```

## 默认配置

`autopub`的一些默认参数可以在当前工作区`package.json`中配置，这样就不用每次均在命令行输入了。

```javascript
{
    "autopub":{
        "report": "versions.md",                  // 发包报告,支持md和json两种格式
        "excludes":["utils","apps"],    
        "versionIncStep": "patch",                // 默认版本增长方式
        "publishScript": "release",               // 包发布脚本名称
    }
}
```

## 列出包

`autopub list`列出当前工作区的所有包，并显示当前包`最近一次发布`和`最近修改时间`。


# 常见问题

- **Q：调用`autopub`时为什么要使用`pnpm autopub`的方式?**

因为在`pnpm/monorepo`工程中，包与包之间可能存在依赖关系，并且其依赖采用的是类似`workspace:^1.0.2`的形式，使用`pnpm autopub`形式时，`pnpm`才可以帮助进行依赖的转换,否则不能正确地处理包与包之间的依赖。
