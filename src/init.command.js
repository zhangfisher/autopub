const { program } = require('commander')
const logger = require("logsets"); 
const { getWorkspaceContext,getPackages } = require('./context')

program
    .command("init")
    .description("注入必要的发包脚本命令")
    .option("-e, --excludes [...name]", "排除不发布的包列表",[])
    .option("-s, --build-script <name>", "包构建脚本名称","build")
    .action(options => {
        const { workspaceRoot } = context = getWorkspaceContext(options)
        try{
            const tasks = logger.tasklist("注入发布脚本")
            // 2. 注入工作区配置
            try{
                tasks.add("<Workspace>")
                const workspacePkgFile = path.join(workspaceRoot,"package.json")
                let workspacePkgData = fs.readJSONSync(workspacePkgFile)
                if(!("autopub" in workspacePkgData)){
                    workspacePkgData["autopub"] = {
                        excludes      : [],                      // 要排除发布的包名称
                        buildScript   : "build",                 // 构建脚本
                        report        : "versions.md",           // 发布报告信息,支持md和json两种格式
                        changeLogs    : "changeLogs",            // 发布变更日志
                        releaseBranch : null,                    // 发布分支，不指定时采用当前分支
                        versionIncStep: "patch",                 // 默认版本增长方式
                        ...options
                    }                
                }            
                const scripts = {
                    "publish:test" : "pnpm autopub --test",
                    "publish:auto" : "pnpm autopub --all",
                    "publish:all"  : "pnpm autopub"
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
        }catch(e){
            context.log(e.stack)
        }finally{
            await context.end()
        }
    })
