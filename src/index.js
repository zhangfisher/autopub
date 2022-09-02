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
 
const fs                 = require("fs-extra");
const { prompt }         = require("enquirer");
const path               = require("path");
const shelljs            = require("shelljs");
const createLogger       = require("logsets"); 
const { Command ,Option} = require('commander');
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
    getPackageReleaseInfo,
    getPackageCommitCount,
    packageIsDirty,
    checkoutBranch,
    getCurrentBranch
 } = require("./utils");
const { start } = require("repl");



const logger = createLogger(); 

const VERSION_STEPS = ["major", "minor", "patch","premajor","preminor","prepatch","prerelease"]

const program =new Command()
 
/**
 * 获取指定包信息
 */
function getPackage(packageFolderName){
    const {excludes,workspaceRoot,workspace} = this
    const packageFolder = path.join(workspaceRoot,"packages",packageFolderName)
    const pkgFile       = path.join(workspaceRoot,"packages",packageFolderName,"package.json")
    if(!fs.existsSync(pkgFile)) return 
    const packageInfo = getPackageJson(pkgFile)
    if(packageInfo){
        const { name, scripts,version,description,dependencies={},devDependencies={},peerDependencies={},optionalDependencies={} } = packageInfo
        // 读取当前包对工作区其他包的依赖列表
        let packageDependencies =[]
        // 如果包存在对工作区其他包的引用
        Object.entries({...dependencies,...devDependencies,...peerDependencies,...optionalDependencies}).forEach(([name,version])=>{
            if(version.startsWith("workspace:") && !excludes.includes(name.replace(`@${workspace.name}/`,""))){
                packageDependencies.push(name)
            }
        })
        return {
            name,                                              // 完整包名，即package.json中的name
            description,                                       // 包描述
            version,
            scripts,                                           //  
            folderName  : packageFolderName,                   // 文件夹名称，可能与package.json中的name相同，也可能不同
            fullPath    : packageFolder,                       // 完整路径
            dependencies: packageDependencies                  // 依赖的工作区包
        }
    }
}

/**
 * 获取当前工作区所有包信息
 * @param {Array} excludes  要排除的包
 * @returns 
 */
function getPackages(){     
    const {excludes,workspaceRoot,workspace} = this
     // 1.读取所有包信息
     let packages = fs.readdirSync(path.join(workspaceRoot,"packages"))
                        .map(packageFolder=>getPackage.call(this,packageFolder))
                        .filter(pkgInfo=>pkgInfo && !excludes.includes(pkgInfo.value))
     // 2.根据依赖关系进行排序： 不处理循环依赖关系
     for(let i=0;i<packages.length;i++){
            for(let j=i;j<packages.length;j++){
                let pkgInfo2 = packages[j]
                if( packages[i].dependencies.includes(pkgInfo2.name)){
                    let p = packages[i]
                    packages[i] = packages[j] 
                    packages[j] = p
                }
            }
     }
     // 3. 如果某个包isDirty=true，则依赖于其的其他包也isDirty=true
    //  packages.forEach(package => {
    //     if(package.isDirty){
    //         packages.forEach(p=>{
    //             if(p.name!==package.name && p.dependencies.includes(package.name)){
    //                 p.isDirty = true
    //             }
    //         })
    //     }
    //  })
     return packages
 }
 

/**
 * 运行指定包的发布脚本命令
 * @param {*} package   = {
*       name,                                              // 完整包名，即package.json中的name
        description,                                       // 包描述
        scripts,
        version,
        folderName,                                         // 文件夹名称，一般与package.json中的name相同
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
 * 
 * 根据包信息依赖关系进行对要发布的包进行排序
 * 
 */
async function readPackages(packages){
    const tasks = logger.tasklist() 
    logger.log("- 读取包信息：")
    for(let package of packages){
        tasks.add(`读取包[${package.name}]`)
        try{
            // 1. 从NPM上读取已发布的包信息
            let releaseInfo = await getPackageReleaseInfo.call(this,package)
            // 将包发布相关信息合并到包中
            Object.assign(package,releaseInfo)
            // 2. 检查当前包自上次发布以来是否有提交
            package.isDirty = await packageIsDirty.call(this,package)             
            tasks.complete(`${shortDate(package.lastPublish)}(V${package.version})`)          
        }catch(e){
            tasks.error(`${e.message}`)
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

        // 第四步：增加git tags

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
        const lastModified   = getFolderLastModified(path.join(workspaceRoot,"packages",package.folderName))
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

/**
 * 读取当前工作区和包信息，该信息将作为this传递给所有相关函数，以便可以获取到共享信息
 * @param {*} options          // 命令行参数
 */
function getWorkspaceContext(options) {
    // 1. 获取当前工作区根路径
    const workspaceRoot =  getWorkspaceRootFolder()
    if(!workspaceRoot) {
        logger.log("命令只能在PNPM工作区内执行,未发现PNPM工作区")
        process.exit(0)
    }
    const workspaceInfo = getPackageJson(workspaceRoot)
    // 2. 生成默认的工作区相关信息
    return {
        workspaceRoot,                           // 工作区根路径
        excludes          : [],                      // 要排除发布的包名称
        lastPublish       : null,                    // 最后发布的时间
        buildScript       : "build",                 // 发布前执行构建的脚本
        releaseScript     : "release",               // 发布命令,当发布所有包时会调用
        report            : "versions.md",           // 发布报告信息,支持md和json两种格式
        changeLogs        : "changeLogs",            // 发布变更日志
        versionIncStep    : "patch",                 // 默认版本增长方式
        silent            : true,                    // 静默发布，不提示信息
        workspace         : workspaceInfo,           // 工作区根文件夹
        distTag           : null,                    // 发布标签 
        test              : false,                   // 模拟发布   
        releaseBranch     : null,                    // 发布分支，未指定时采用当前分支
        force             : false,                   // 强制发布包
        pnpmPublishOptions: {},                //
        packages          : null,                    // packages包
        logs              : [],                       // 发包日志，后续会保存到autopub.log
        log               : function(info){this.logs.push(info)},
        ...workspaceInfo.autopub || {},          // 配置参数
        ...options,
    }        
}

program
    .command("list")
    .description("列出当前工作区的所有包")
    .action(async (options) => {
        const context = getWorkspaceContext(options)
        const { workspaceRoot } = context
        const table = logger.table({grid:1})
        table.addHeader("包名","版本号","最近发布","自上次至今提交数")        
        context.packages = getPackages.call(context)
        await readPackages.call(context, context.packages)
        for(let package of context.packages){
            const lastPublish    = package.lastPublish ? shortDate(package.lastPublish) : "None"
            const lastPublishRef = package.lastPublish ? `(${relativeTime(package.lastPublish)})` : ""
            if(package.lastPublish){
                table.addRow(package.name,package.version,`${lastPublish}(${lastPublishRef})`,package.newCommits)
            }else{
                table.addRow(package.name,package.version,"None",package.newCommits)
            }
        } 
        table.render()
    })
 
program
    .command("init")
    .description("注入必要的发包脚本命令")
    .option("-e, --excludes [...name]", "排除不发布的包列表",[])
    .option("-s, --release-script <name>", "包发布脚本名称","release")
    .action(options => {
        const { workspaceRoot } = context = getWorkspaceContext(options)
        logger.log(" - 注入发布脚本")
        const tasks = logger.tasklist()
        const packages  = getPackages.call(context)
        packages.forEach(package => {
            tasks.add(`packages/${package.name}`)
            try{
                const packageFolder = path.join(workspaceRoot,"packages",package.folderName) 
                const pkgFile       = path.join(packageFolder, "package.json")
                let packageData     = getPackageJson(packageFolder)
                const releaseScript = "pnpm autopub"
                if(packageData){
                    if(!packageData.scripts) packageData.scripts = {}
                    if(options.releaseScript in packageData.scripts){
                        let oldScript = String(packageData.scripts[options.releaseScript])
                        if(!oldScript.includes(releaseScript)){
                            if(oldScript.trim()!="") oldScript = oldScript + " && "
                        }
                        oldScript = oldScript + releaseScript
                    }else{
                        packageData.scripts[options.releaseScript] = releaseScript
                    }
                }
                fs.writeJSONSync(pkgFile,packageData,{spaces:4})
                tasks.complete()
            }catch(e){
                tasks.error(e.message)
            }            
        })

        // 2. 注入工作区配置
        try{
            tasks.add("<Workspace>")
            const workspacePkgFile = path.join(workspaceRoot,"package.json")
            let workspacePkgData = fs.readJSONSync(workspacePkgFile)
            if(!("autopub" in workspacePkgData)){
                workspacePkgData["autopub"] = {
                    excludes      : [],                      // 要排除发布的包名称
                    releaseScript : "release",               // 发布命令，当发布所有包时会调用pnpm release,您也可以指定其他名称
                    report        : "versions.md",           // 发布报告信息,支持md和json两种格式
                    changeLogs    : "changeLogs",            // 发布变更日志
                    releaseBranch : null,                    // 发布分支，不指定时采用当前分支
                    versionIncStep: "patch",                 // 默认版本增长方式
                    ...options
                }                
            }            
            const scripts = {
                "publish:test" : "pnpm autopub --all --no-ask --test",
                "publish:auto" : "pnpm autopub --all --no-ask",
                "publish:all"  : "pnpm autopub --all"
            }
            Object.entries(scripts).forEach(([name, script]) => {
                workspacePkgData.scripts[name] = script
            }) 
            packages.forEach(({name}) => {
                workspacePkgData.scripts[`publish:${name}`] = `pnpm autopub --package ${name}`
            }) 
            fs.writeJSONSync(workspacePkgFile,workspacePkgData,{spaces:4})
            tasks.complete()
        }catch(e){
            tasks.error(e.message)
        }

        logger.log("- 使用方法：")
        logger.log("\t测试发布： {}","pnpm publish:test" )
        logger.log("\t自动发布： {}","pnpm publish:auto" )
        logger.log("\t交互发布： {}","pnpm publish:all" )

    })
 


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
            context.packages =  getPackages.call(context)
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
 
 