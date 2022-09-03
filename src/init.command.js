const { program } = require('commander')
const createLogger = require("logsets"); 
const { getWorkspaceContext,getPackages } = require('./context')
const { shortDate,relativeTime } = require('./utils')

const logger = createLogger();

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
                const packageFolder = path.join(workspaceRoot,"packages",package.dirName) 
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
