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
const createLogger            = require("logsets"); 
const { Command ,Option}      = require('commander');
const { getWorkspaceContext } = require('./context')
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
    longDate,
    checkoutBranch,
    getCurrentBranch
 } = require("./utils"); 


const logger = createLogger(); 

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
        if(releaseBranch != currentBranch){
            logger.log("- 切换到发布分支: {}",releaseBranch)
        }
        // 切换到发布分支
        if(releaseBranch && releaseBranch!=currentBranch){
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
 * 发布所有包
 * @param {*} packages  [{...},{...}]
 */
async function publishAllPackages(packages){
    const { workspaceRoot,force,log } = this    
    // 1. 读取包信息
    readPackages.call(this,packages)

    logger.log("- 开始发布包：")    
    const tasks = logger.tasklist()
    // 2. 依次发布每个包
    for(let package of packages){
        tasks.add(`发布包[${package.name}]`)
        try{
            if(package.isDirty || force){
                await publishPackage.call(this,package)
                tasks.complete(`${package.version}->${getPackageJson().version}`)
            }else{
                tasks.skip()
            }            
        }catch(e){
            tasks.error(`${e.message}`)
        }
    }
}

/**
 * 发布指定的包
 * 
 *  - 
 *  - 并且在package.json中记录最后发布时间
 * 
 * 本命令只能在包文件夹下执行
 * 
 * @param {*} options 
 */
async function publishPackage(){
    const {workspaceRoot,distTag,pnpmPublishOptions={}, build,test,buildScript,versionIncStep, silent,package:currentPackage} = this    
    // 1. 切换到包所在目录
    const packageFolder = currentPackage ? path.join(workspaceRoot,"packages",currentPackage) : getPackageRootFolder()
    const pkgFile = path.join(packageFolder, "package.json")
    if(!fs.existsSync(pkgFile)) throw new Error("无效的包路径:"+packageFolder)    
    shelljs.cd(packageFolder)        

    // 2. 读取package.json信息
    let  packageInfo  = getPackageJson(packageFolder)
    const packageName = packageInfo.name
    const oldVersion = packageInfo.version
    // 备份package.json以便在出错时能还原
    let packageBackup = Object.assign({},packageInfo)            

    logger.log("发布包：{}",packageName)   
    
    const tasks = logger.tasklist()
    try{
        //  第1步： 更新版本号和发布时间
        tasks.add(`自增版本号(${versionIncStep}++)`) 
        await asyncExecShellScript.call(this,`npm version ${versionIncStep}`,{silent})              
        packageInfo = getPackageJson(packageFolder) // 重新读取包数据以得到更改后的版本号    
        packageBackup = Object.assign({},packageInfo)
        tasks.complete(`${oldVersion}->${packageInfo.version}`)   

        // 第二步：构建包：发布前进行自动构建
        if(build && buildScript in packageInfo.scripts){
            tasks.add("构建包")
            await asyncExecShellScript.call(this,`pnpm ${buildScript}`,{silent})
            tasks.complete()
        }      

        // 第三步：发布
        // 由于工程可能引用了工作区内的其他包，必须pnpm publish才能发布
        // pnpm publish会修正引用工作区其他包到的依赖信息，而npm publish不能识别工作区内的依赖，会导致报错        
        tasks.add("发布包")
        let opts = [
            "--no-git-checks",
            "--access public",
            ...pnpmPublishOptions
        ]
        if(distTag) opts.push(`--tag ${distTag}`)
        if(test) opts.push("--dry-run")
        await asyncExecShellScript.call(this,`pnpm publish --no-git-checks ${opts.join(" ")}`,{silent})            
        tasks.complete()   

        // 第四步：更新发布时间
        tasks.add("更新发布时间")
        packageInfo.lastPublish = dayjs().format()
        fs.writeFileSync(pkgFile,JSON.stringify(packageInfo,null,4))
        tasks.complete()

    }catch(e){// 如果发布失败，则还原package.json        
        fs.writeFileSync(pkgFile,JSON.stringify(packageBackup,null,4))
        tasks.error(`${e.message}`)
    }finally{        
        if(test && packageBackup){// 模拟测试时恢复修改版本号
            fs.writeFileSync(pkgFile,JSON.stringify(packageBackup,null,4))
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
 * @param {*} packages 
 * @param {*} options 
 * @returns   {selectedPackages,distTag,versionIncStep }
 */
async function askForPublishPackages(packages,options){
    let  { workspaceRoot,versionIncStep:curVerIncStep } = this
    let selectedCount = 0;
    let packageChoices = packages.map(package => {
        const lastPublish    = package.lastPublish ? shortDate(package.lastPublish) : "None"
        const lastPublishRef = package.lastPublish ? `(${relativeTime(package.lastPublish)})` : ""
        const lastModified   = getFolderLastModified(path.join(workspaceRoot,"packages",package.dirName))
        const lastUpdate     = shortDate(lastModified)                  
        const lastUpdateRef  = relativeTime(lastModified)
        return {
            ...package,
            value: package,
            name : `${package.name.padEnd(24)}Version: ${package.version.padEnd(8)} LastPublish: ${lastPublish.padEnd(16)}${lastPublishRef} lastModified: ${lastUpdate}(${lastUpdateRef})`,                        }
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
        // 切换到发布分支
        switchToReleaseBranch.call(this)
        if(options.all){  // 自动发布所有包
            context.packages =await  getPackages.call(context)
            if(options.ask){
                await askForPublishPackages.call(context,packages)                
            }
            if(context.packages.length > 0){
               await publishAllPackages.call(context,context.packages)
            }
        }else{// 只发布指定的包
            await publishPackage.call(context)
        }
        // 在文档中输出各包的版本信息
        generatePublishReport.call(context)
     })

 program.parseAsync(process.argv);
 
 