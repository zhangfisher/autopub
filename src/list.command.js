const { program } = require('commander')
const logger = require("logsets"); 
const { getWorkspaceContext,getPackages } = require('./context')
const { shortDate,relativeTime } = require('./utils')
 

program
    .description("列出当前工作区的所有包")
    .action(async (options) => {
        const context = getWorkspaceContext(options)
        try{
            const { workspaceRoot } = context

            const tasks = logger.tasklist()        
            tasks.add("开始读取包信息")
            context.packages = await getPackages.call(context)
            tasks.complete()

            const table = logger.table({grid:1})
            table.addHeader("包名","版本号","最近发布","总提交数","新增提交")        
            for(let package of context.packages){            
                const lastPublish    = package.lastPublish ? shortDate(package.lastPublish) : "None"
                const lastPublishRef = package.lastPublish ? `(${relativeTime(package.lastPublish)})` : ""
                if(package.lastPublish){
                    table.addRow(package.name,package.version,`${lastPublish}(${lastPublishRef})`,package.totalCommits,package.newCommits)
                }else{
                    table.addRow(package.name,package.version,"None",package.totalCommits,package.newCommits)
                }
            } 
            table.render()
        }catch(e){
            context.log(`ERROR: ${e.stack}`)
        }finally{
            await context.end()
        }
    })

program.parse(process.argv);


