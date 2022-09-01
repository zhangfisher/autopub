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
    execShellScriptWithReturns,
    getFolderLastModified,
    getFileLastModified,
    isAfterTime,
    isSameTime,
    relativeTime,
    shortDate,
    longDate 
 } = require("./utils")



const logger = createLogger(); 

const VERSION_STEPS = ["major", "minor", "patch","premajor","preminor","prepatch","prerelease"]

const program =new Command()
 
/**
 * 获取当前工作区所有包信息
 * @param {Array} excludes  要排除的包
 * @returns 
 */
function getPackages(){     
    const {excludes,workspaceRoot,workspace} = this
     // 1.读取所有包信息
     let packages = fs.readdirSync(path.join(workspaceRoot,"packages")).map(packageName=>{
        const packageFolder = path.join(workspaceRoot,"packages",packageName)
        const pkgFile = path.join(workspaceRoot,"packages",packageName,"package.json")
        if(!fs.existsSync(pkgFile)) return 
        const packageInfo = getPackageJson(pkgFile)
        if(packageInfo){
            const { name,lastPublish, scripts,version,description,dependencies={},devDependencies={},peerDependencies={},optionalDependencies={} } = packageInfo
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
                lastPublish,
                scripts,                                           //  
                folderName  : packageName,                         // 文件夹名称，一般与package.json中的name相同
                fullPath    : packageFolder,                       // 完整路径
                isDirty     : packageIsDirty.call(this,packageFolder),       // 包自上次发布之后是否已修改              
                dependencies: packageDependencies                  // 依赖的工作区包
            }
        }
     }).filter(pkgInfo=>pkgInfo && !excludes.includes(pkgInfo.value))

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
     packages.forEach(package => {
        if(package.isDirty){
            packages.forEach(p=>{
                if(p.name!==package.name && p.dependencies.includes(package.name)){
                    p.isDirty = true
                }
            })
        }
     })
     return packages
 }
 

/**
 * 运行指定包的发布脚本命令
 * @param {*} package   = {
*       name,                                              // 完整包名，即package.json中的name
        description,                                       // 包描述
        scripts,
        version,
        lastPublish,
        folderName,                                         // 文件夹名称，一般与package.json中的name相同
        fullPath,                                           // 完整路径
        isDirty,                                            // 包自上次发布之后是否已修改              
        dependencies                                        // 依赖的工作区包
 *  }  
 */
async function runPackageScript(package){
    const {workspaceRoot,silent=true,publishScript} = this
    const lastModified  = getFolderLastModified.call(this,package.fullPath)
    // 每个包必须定义自己的发布脚本
    if(publishScript in package.scripts){
        shelljs.cd(package.fullPath)      // 进入包所在的文件夹
        await asyncExecShellScript.call(this,`pnpm ${publishScript}`,{silent})
    }else{
        throw new Error(`包[{${package}}]需要声明名称为[${publishScript}]的自动发布脚本`)
    }
}

/**
 * 
 * 判断包自上次发布之后是否有更新过
 * 
 * @param {*} packageFolder
 * 
 * 
 */
function packageIsDirty(packageFolder){
    const pkgFile = path.join(packageFolder,"package.json")
    const packageData  = fs.readJSONSync(pkgFile)
    const lastModified = getFolderLastModified.call(this,packageFolder)
    const lastPublish  = packageData.lastPublish
    // 由于上一次发布时会更新package.json文件，如果最后更新的文件时间==package.json文件最后更新时间，则说明没有更新
    const pkgLastModified =  getFileLastModified(pkgFile)
    return isAfterTime(lastModified,lastPublish) && !isSameTime(pkgLastModified,lastModified)
}

/**
 * 发布所有包
 * 
 * 将比对最后发布时间和最后修改时间的差别来决定是否发布
 * 
 * 
 * @param {*} packages  [{...},{...}]
 */
async function publishAllPackages(packages){
    const { workspaceRoot,force } = this
    const tasks = logger.tasklist()
    // 依次对每个包进行发布
    for(let package of packages){
        tasks.add(`发布包[${package.name}]`)
        try{
            if(package.isDirty || force){
                await runPackageScript.call(this,package)
                // 由于执行发布包后会更新package.json中的version，需要重新读取
                let { version } = fs.readJSONSync(path.join(workspaceRoot,"packages",package.folderName,"package.json"))
                tasks.complete(`${package.version}->${version}`)
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
    const {workspaceRoot,distTag, dryRun,buildScript,versionIncStep, silent=true,package:currentPackage} = this
    // 1. 切换到包所在目录
    const packageFolder = currentPackage ? path.join(workspaceRoot,"packages",currentPackage) : getPackageRootFolder()
    const pkgFile = path.join(packageFolder, "package.json")
    shelljs.cd(packageFolder)
    // 2. 读取package.json信息
    let  packageInfo  = getPackageJson(packageFolder)
    if(!packageInfo){
        logger.log("读取package.json文件失败")
        throw new Error("当前包不存在package.json文件,请在包文件夹下执行")
    }  
    const packageName = packageInfo.name
    const oldVersion = packageInfo.version
    // 备份package.json以便在出错时能还原
    let packageBackup = Object.assign({},packageInfo)            

    logger.log("发布包：{}",packageName)   
    
    const tasks = logger.tasklist()
    try{
        //  第1步： 更新版本号和发布时间
        tasks.add("更新版本号")
        await asyncExecShellScript.call(this,`npm version ${versionIncStep}`,{silent})
        // 重新读取包数据以得到更改后的版本号       
        packageInfo = fs.readJSONSync(pkgFile)
        packageBackup = Object.assign({},packageInfo)
        tasks.complete(`${oldVersion}->${packageInfo.version}`)   

        // 第二步：构建包
        if(buildScript in packageInfo.scripts){
            tasks.add("构建包")
            await asyncExecShellScript.call(this,`pnpm {buildScript}`,{silent})
            tasks.complete()
        }      

        // 第三步：发布
        // 由于工程可能引用了工作区内的其他包，必须pnpm publish才能发布
        // pnpm publish会修正引用工作区其他包到的依赖信息，而npm publish不能识别工作区内的依赖，会导致报错        
        tasks.add("发布包")
        let opts = [
            "--no-git-checks",
            "--access public"
        ]
        if(distTag) opts.push(`--tag ${distTag}`)
        if(dryRun) opts.push("--dry-run")
        await asyncExecShellScript.call(this,`pnpm publish --no-git-checks ${opts.join(" ")}`,{silent})            
        tasks.complete()        

        // 第四步：更新发布时间
        tasks.add("更新发布时间")
        packageInfo.lastPublish = new Date()
        fs.writeFileSync(pkgFile,JSON.stringify(packageInfo,null,4))
        tasks.complete()
    }catch(e){// 如果发布失败，则还原package.json        
        fs.writeFileSync(pkgFile,JSON.stringify(packageBackup,null,4))
        tasks.error(`${e.message}`)
    }finally{
        // 模拟测试时恢复修改版本号
        if(dryRun && packageBackup){
            fs.writeFileSync(pkgFile,JSON.stringify(packageBackup,null,4))
        }
    }
}

// 生成包版本列表文件到文档中
function generatePublishReport(){
    const {workspaceRoot,tag,report="versions.md"} = this 
    let reportFile = path.isAbsolute(report) ? report : path.join(workspaceRoot,report)
    let results = []
    results.push("# 版本信息")
    results.push("| 包| 版本号| 最后更新 | 说明|")
    results.push("| --- | :---: | :---: | --- |")
    getPackages.call(this).forEach(package => {
        const lastPublish = package.lastPublish ? longDate(package.lastPublish) : "None"
        results.push(`|**${package.name}**|${package.version}|${lastPublish}|${package.description}|`)
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
    const {workspaceRoot,versionIncStep } = this
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
            initial: VERSION_STEPS.indexOf(versionIncStep),
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
    return await prompt(questions); 
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
        excludes      : [],                      // 要排除发布的包名称
        lastPublish   : null,                    // 最后发布的时间
        publishScript : "release",               // 发布命令，当发布所有包时会调用pnpm release,您也可以指定其他名称
        report        : "versions.md",           // 发布报告信息,支持md和json两种格式
        changeLogs    : "changeLogs",            // 发布变更日志
        versionIncStep: "patch",                  // 默认版本增长方式
        silent        : true,                    // 静默发布，不提示信息
        workspace     : workspaceInfo,           // 工作区根文件夹
        distTag       : null,                    // 发布标签 
        dryRun        : false,                   // 模拟发布   
        force         : false,                   // 强制发布包    
        packages      : null,                    // packages包
        ...workspaceInfo.autopub || {},          // 配置参数
        ...options
    }        
}

program
    .command("list")
    .description("列出当前工作区的所有包")
    .action(options => {
        const context = getWorkspaceContext(options)
        const { workspaceRoot } = context
        const table = logger.table({grid:1})
        table.addHeader("包名","版本号","最后提交时间","最后修改时间")
        getPackages.call(context).forEach(package => {
            const lastPublish    = package.lastPublish ? shortDate(package.lastPublish) : "None"
            const lastPublishRef = package.lastPublish ? `(${relativeTime(package.lastPublish)})` : ""
            const lastModified   = getFolderLastModified(path.join(workspaceRoot,"packages",package.folderName))
            const lastUpdate     = shortDate(lastModified)                    
            const lastUpdateRef  = relativeTime(lastModified)   
            if(package.lastPublish){
                table.addRow(package.name,package.version,`${lastPublish}(${lastPublishRef})`,`${lastUpdate}(${lastUpdateRef})`)
            }else{
                table.addRow(package.name,package.version,"None",`${lastUpdate}(${lastUpdateRef})`)
            }
        })
        table.render()
    })
 
program
    .command("init")
    .description("注入必要的发包脚本命令")
    .option("-e, --excludes [...name]", "排除不发布的包列表",[])
    .option("-s, --publish-script <name>", "包发布脚本名称","release")
    .action(options => {
        const context = getWorkspaceContext(options)
        const { workspaceRoot } = context

        logger.log(" - 注入脚本")

        const tasks = logger.tasklist()
        // 1. 在各个包中注入
        const packages  = getPackages.call(context)
        packages.forEach(package => {
            tasks.add(`packages/${package.name}`)
            try{
                const packageFolder = path.join(workspaceRoot,"packages",package.folderName) 
                const pkgFile = path.join(packageFolder, "package.json")
                let packageData  = getPackageJson(packageFolder)
                const releaseScript =  "pnpm autopub"
                if(packageData){
                    if(!packageData.scripts) packageData.scripts = {}
                    if(options.publishScript in packageData.scripts){
                        let oldScript = String(packageData.scripts[options.publishScript])
                        if(!oldScript.includes(releaseScript)){
                            if(oldScript.trim()!="") oldScript = oldScript + " && "
                        }
                        oldScript = oldScript + releaseScript
                    }else{
                        packageData.scripts[options.publishScript] = releaseScript
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
                    publishScript : "release",               // 发布命令，当发布所有包时会调用pnpm release,您也可以指定其他名称
                    report        : "versions.md",           // 发布报告信息,支持md和json两种格式
                    changeLogs    : "changeLogs",            // 发布变更日志
                    versionIncStep: "patch",                  // 默认版本增长方式
                    ...options
                }
                
                
            }            
            const scripts = {
                "publish:mock" : "pnpm autopub --all --no-ask --dry-run",
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
        logger.log("\t模拟发布： {}","pnpm publish:mock" )
        logger.log("\t自动发布： {}","pnpm publish:auto" )
        logger.log("\t交互发布： {}","pnpm publish:all" )

    })
 

program
     .description("自动发布包到NPM")
     .option("-a, --all", "发布所有包")
     .option("-f, --force", "强制发布包")
     .option("-n, --no-ask", "不询问直接发布")
     .option("-p, --package [name]", "指定要发布的包名称")
     .option("-s, --no-silent", "静默显示脚本输出")
     .option("-d, --dry-run", "不真实发布到NPM")
     .option("-t, --dist-tag <value>", "dist-tag")
     .option("-e, --excludes [...name]", "排除不发布的包列表",[])
     .addOption(new Option('-i, --version-increment-step [value]', '版本增长方式').default("patch").choices(VERSION_STEPS))
     .action(async (options) => {              
        let context = getWorkspaceContext(options)
        if(options.all){  // 自动发布所有包
            let packages =  getPackages.call(context)
            if(options.ask){
                let { selectedPackages, distTag, versionIncStep } = await askForPublishPackages.call(context,packages)
                if(selectedPackages!='auto'){
                    packages = selectedPackages
                    if(selectedPackages.length ==0 ) return
                    context.packages = packages
                }  
                context.packages       = packages              
                context.distTag        = distTag
                context.versionIncStep = versionIncStep
            }
            if(packages.length > 0){
               await publishAllPackages.call(context,packages,options)
            }
        }else{// 只发布指定的包
            await publishPackage.call(context)
        }
        // 在文档中输出各包的版本信息
        generatePublishReport.call(context)
     })

 program.parseAsync(process.argv);
 
 