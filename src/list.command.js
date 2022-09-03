const { program } = require('commander')
const createLogger = require("logsets"); 
const { getWorkspaceContext,getPackages } = require('./context')
const { shortDate,relativeTime } = require('./utils')

const logger = createLogger();

program
    .description("列出当前工作区的所有包")
    .action(async (options) => {
        const context = getWorkspaceContext(options)
        const { workspaceRoot } = context
        const table = logger.table({grid:1})
        table.addHeader("包名","版本号","最近发布","总提交数","新增提交")        
        context.packages =await getPackages.call(context)
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
    })

program.parse(process.argv);


