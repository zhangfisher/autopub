/**
 *    用于基于pnpm的多包自动发布工具
 *    
 *  1. 在各个包package.json中添加scripts  
 *  {
 *      scripts:{
 *          "release":"autopub [options]",
 *      }   
 *  } 
 *  2. 在工作区的package.json中添加
 *  {
 *      scripts:{
 *          "publish:auto":"pnpm autopub -- --all --no-ask",    // 全自动发布
 *          "publish:all":"pnpm autopub -- --all",              // 交互式发布
 *      }   
 *  } 
 * 
 */
 
const fs                      = require("fs-extra");
const { prompt }              = require("enquirer");
const path                    = require("path");
const shelljs                 = require("shelljs");
const logger                  = require("logsets"); 
const dayjs                   = require("dayjs")
const { Command ,Option}      = require('commander');
const { getWorkspaceContext,getPackages } = require('./context')

const { checkoutBranch, getCurrentBranch,recoveryFileToLatest,commitFiles } = require("./gitOperates");
const { 
    getPackageJson,
    getPackageRootFolder,
    getWorkspaceRootFolder,
    asyncExecShellScript,
    getFolderLastModified,
    getFileLastModified,
    isAfterTime,
    isSameTime,
    relativeTime,
    shortDate,
    longDate
 } = require("./utils");

 
const VERSION_STEPS = ["major", "minor", "patch","premajor","preminor","prepatch","prerelease"]

const program =new Command()
 
/**
 * 运行指定包的发布脚本命令
 * @param {*} package   = {
*       name,                                              // 完整包名，即package.json中的name
        description,                                       // 包描述
        scripts,
        version,
        dirName,                                         // 文件夹名称，一般与package.json中的name相同
        fullPath,                                           // 完整路径
        dependencies                                        // 依赖的工作区包
 *  }  
 */
async function runPackageReleaseScript(package){
    const {workspaceRoot,silent=true,releaseScript} = this
    // 每个包必须定义自己的发布脚本
    if(releaseScript in package.scripts){
        shelljs.cd(package.fullPath)      // 进入包所在的文件夹
        await asyncExecShellScript.call(this,`pnpm ${releaseScript}`,{silent})
    }else{
        throw new Error(`包[{${package}}]未声明名称为[${releaseScript}]的自动发布脚本`)
    }
}

 
/**
 * 切换到发布分支
 */
function switchToReleaseBranch(){    
    let { releaseBranch } = this
    let currentBranch,isCheckout = false    
    try{        
        currentBranch = getCurrentBranch()
        logger.log("- 当前分支: {}",currentBranch)
        logger.log("- 发布分支: {}",releaseBranch || currentBranch)
        if(releaseBranch && releaseBranch != currentBranch){
            logger.log("- 切换到发布分支: {}",releaseBranch)
            checkoutBranch(releaseBranch)
            isCheckout = true
        }             
    }catch(e){        
        throw e
    }finally{
        if(isCheckout){
            this.oldBranch = currentBranch   // 记录下曾经切换到的分支，以便恢复
        }
    }
}

/**
 * 当发布成功后为git添加发布标签
 * 
 * 如: 1.2.3-latest
 * 
 * 标签到由<版本号>+<dist-tag>组成
 * 
 * 由于各包采用的是不同的版本号，所有在工作区开发分支上打上dist-tag,但是不包括版本号
 */
async function commitChanges(publishedPackages){
    const { workspaceRoot,distTag,addGitTag } = this    
    if(publishedPackages.length==0) return 
    // 1. 提交改变
    const pkgFiles = publishedPackages.map(pakcage=>path.join(package.fullPath,"package.json"))
    const pubMessages = publishedPackages.map(package=>{
        `release: v${package.version}${distTag ? '-' + distTag : ''}`
    })
    commitFiles(pkgFiles,pubMessages.join("\n"))
    // 2. 打上标签
    if(addGitTag){
        addGitTag(`${publishedPackages[0].name}-${distTag ? distTag+'-' : ''}${publishedPackages[0].version}`,pubMessages)
    }
}

/**
 * 发布所有包
 * @param {*} packages  [{...},{...}]
 */
async function publishAllPackages(packages){
    const { workspaceRoot,force,log,test } = this  
    let publishedPackages = []  // 保存成功发布的包的package.json文件  

    logger.log("- 开始发布包：")    
    const tasks = logger.tasklist()
    // 2. 依次发布每个包
    for(let package of packages){
        const task = tasks.add(`发布包[${package.name}]`)
        try{
            if(package.private!==true && (package.isDirty || force)){
                this.package = package
                await publishPackage.call(this,task)
                publishedPackages.push(package)
                tasks.complete(`${package.version}->${getPackageJson().version}`)
            }else{
                tasks.skip()
            }            
        }catch(e){
            log(e.stack)
            tasks.error(`${e.message}`)
        }
    }

    // 第五步：提交Git并打上标签
    // 由于发布包后会修改packages/xxx/package.json
    if(!test){
        try{
            tasks.add("提交变更到Git")
            await commitChanges.call(this,pkgFiles)
        }catch(e){
            log(e.stack)
            tasks.error(e.message)
        }
    }
}

/**
 * 发布指定的包
 * 
 *  - 并且在package.json中记录最后发布时间
 * 
 * 本命令只能在包文件夹下执行
 * 
 * @param {*} options 
 */
async function publishPackage(task){
    const {workspaceRoot,distTag, build,test,buildScript,versionIncStep, silent,package:currentPackage} = this    
    // 1. 切换到包所在目录
    const packageFolder = currentPackage ? path.join(workspaceRoot,"packages",currentPackage) : getPackageRootFolder()
    const pkgFile = path.join(packageFolder, "package.json")
    if(!fs.existsSync(pkgFile)) throw new Error("无效的包路径:"+packageFolder)    
    shelljs.cd(packageFolder)        

    // 2. 读取package.json信息
    let  packageInfo  = getPackageJson(packageFolder)
    const packageName = packageInfo.name
    const oldVersion = packageInfo.version        

    
    logger.log("发布包：{}",packageName)   
    
    let isChange = false , hasError = false
    
    const isTaskItem = !!task
    
    const tasks = isTaskItem ? logger.tasklist() : null

    const addTaskLog = (info)=>{
        if(task){
            task.note(info)
        }else{
            tasks.add(info)
        }
    } 

    try{
        //  第1步： 更新版本号和发布时间
        addTaskLog(`自增版本号(${versionIncStep}++)`) 
        await asyncExecShellScript.call(this,`npm version ${versionIncStep}`,{silent})              
        packageInfo = getPackageJson(packageFolder) // 重新读取包数据以得到更改后的版本号    
        if(isTaskItem) tasks.complete(`${oldVersion}->${packageInfo.version}`)   
        isChange = true     // 有改变的包版本号

        // 第二步：构建包：发布前进行自动构建
        if(build && buildScript in packageInfo.scripts){
            addTaskLog("构建包")
            await asyncExecShellScript.call(this,`pnpm ${buildScript}`,{silent})
            if(isTaskItem) tasks.complete()
        }      

        // 第三步：发布
        // 由于工程可能引用了工作区内的其他包，必须pnpm publish才能发布
        // pnpm publish会修正引用工作区其他包到的依赖信息，而npm publish不能识别工作区内的依赖，会导致报错        
        addTaskLog("开始发布")
        let opts = [
            "--no-git-checks",
            "--access public",
        ]
        if(distTag) opts.push(`--tag ${distTag}`)
        if(test) opts.push("--dry-run")
        await asyncExecShellScript.call(this,`pnpm publish ${opts.join(" ")}`,{silent})            
        if(isTaskItem) tasks.complete()   

        // 第四步：更新发布时间
        addTaskLog("更新发布时间")
        packageInfo.lastPublish = dayjs().format()
        fs.writeFileSync(pkgFile,JSON.stringify(packageInfo,null,4))
        if(isTaskItem) tasks.complete()

    }catch(e){// 如果发布失败，则还原package.json        
        if(isChange) recoveryFileToLatest(pkgFile)
        if(isTaskItem) tasks.error(`${e.message}`)
    }finally{        
        if(test && isChange && !hasError){// 模拟测试时恢复修改版本号
            recoveryFileToLatest(pkgFile)
        }
    }
}

// 生成包版本列表文件到文档中
function generatePublishReport(){
    const {workspaceRoot,distTag,report="versions.md"} = this 
    let reportFile = path.isAbsolute(report) ? report : path.join(workspaceRoot,report)
    const format = reportFile.endsWith('.json') ? 'json' : 'md'
    let results = format=='json' ? {} : []

    if(format=='json'){

    }else{
        results.push("# 版本信息")
        results.push("| 包| 版本号| 最后更新 | 说明|")
        results.push("| --- | :---: | :---: | --- |")
    }
    
    getPackages.call(this).forEach(package => {
        const lastPublish = package.lastPublish ? longDate(package.lastPublish) : "None"
        if(format=='json'){
            results[package.name]= {
                name       : package.name,                                              // 完整包名，即package.json中的name
                description: package.description,                                       // 包描述
                version    : package.version,
                lastPublish: package.lastPublish
            }
        }else{
            results.push(`|**${package.name}**|${package.version}|${lastPublish}|${package.description}|`)    
        }        
    })     
    fs.writeFileSync(reportFile, results.join("\n"))
}

/**
 * 向用户询问要发布哪些包
 * @returns   {selectedPackages,distTag,versionIncStep }
 */
async function askForPublishPackages(){
    let  { workspaceRoot,versionIncStep:curVerIncStep,packages } = this
    let selectedCount = 0;
    let packageChoices = packages.map(package => {
        const lastPublish    = package.lastPublish ? shortDate(package.lastPublish) : "None"
        const lastPublishRef = package.lastPublish ? `(${relativeTime(package.lastPublish)})` : ""
        return {
            ...package,
            value: package,
            name : `${package.name.padEnd(24)}Version: ${package.version.padEnd(8)} LastPublish: ${lastPublish.padEnd(16)}${lastPublishRef} newCommits: ${package.newCommits}`,                        }
    })
    packageChoices.splice(0,0,"auto")
    let questions = [
        {
            type   : 'multiselect',
            name   : 'selectedPackages',
            message: '选择要发布的包',
            initial: 0,
            choices: packageChoices,        
            result: function(names) {
                if (names.length === 0) return [];
                selectedCount = names.length;
                return names.includes('auto') ? 'auto' : Object.values(this.map(names));
            }
        },
        {
            type   : 'select',
            name   : 'versionIncStep',
            message: '选择版本号递增方式：',
            choices: VERSION_STEPS,
            initial: VERSION_STEPS.indexOf(curVerIncStep),
            skip   : () => selectedCount === 0
        }, 
        {
            type   : 'input',
            name   : 'distTag',
            message: '指定发布标签：',
            footer : 'eg. latest, beta, test, alpha, stable, next, ...',
            initial: 'latest',
            result : (tag) => tag === 'latest' ? null : tag,
            skip   : () => selectedCount === 0
        } 
    ]; 
    const {selectedPackages,distTag,versionIncStep} = await prompt(questions);
    
    let context  = this
    if(selectedPackages!='auto'){
        context.packages = selectedPackages
    }  
    context.distTag        = distTag 
    context.versionIncStep = versionIncStep
}



program
    .command("init","注入必要的发包脚本命令",{executableFile: "./init.command.js"})
    .command("list","列出当前工作区的包",{executableFile: "./list.command.js"})
    .command("sync","同步本地与NPM的包信息",{executableFile: "./sync.command.js"})
    .command("publish","发布指定的包",{executableFile: "./publish.command.js"})

program
     .description("一健自动发包工具")
     .option("-a, --all", "发布所有包")
     .option("-f, --force", "强制发布包")
     .option("-n, --no-ask", "不询问直接发布")
     .option("-p, --package [name]", "指定要发布的包名称")
     .option("-s, --no-silent", "静默显示脚本输出")
     .option("--test", "模拟发布")
     .option("--no-build", "发布前不执行Build脚本")
     .option("-b, --release-branch", "发布Git分支")     
     .option("-e, --excludes [...name]", "排除不发布的包列表",[])
     .option("--auto-git-tag", "发布成功后添加Git tag")
     .option("--dist-tag <value>", "dist-tag")
     .addOption(new Option('-i, --version-increment-step [value]', '版本增长方式').default("patch").choices(VERSION_STEPS))
     .action(async (options) => {              
        let context = getWorkspaceContext(options)
        try{
            // 切换到发布分支
            switchToReleaseBranch.call(this)
            if(options.all){  // 自动发布所有包
                context.packages =await  getPackages.call(context)
                if(options.ask){
                    await askForPublishPackages.call(context)                
                }
                if(context.packages.length > 0){
                await publishAllPackages.call(context,context.packages)
                }
            }else{// 只发布指定的包
                await publishPackage.call(context)
            }
            // 在文档中输出各包的版本信息
            generatePublishReport.call(context)
        }catch(e){
            context.log(e.stack)
        }finally{
            context.end()
        }        
     })

 program.parseAsync(process.argv);
 
 