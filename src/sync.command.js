/**
 * 
 * AutoPub在package.json/lastPublish中记录最近发布时间
 * 
 * 如果由于某此原因导至发布时间丢失就会使用自动发包过程无法进行，
 * sync命令就是用来从npm中读取当前已发包的信息来更新本地的package.json/lastPublish
 * 
 * 
 */
const { program } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const createLogger = require("logsets"); 
const { getWorkspaceContext,getPackages } = require('./context')
const { getPackageReleaseInfo,getPackageJson,shortDate } = require('./utils')

const logger = createLogger();

/**
 * 
 * 根据包信息依赖关系进行对要发布的包进行排序
 * 
 */
 async function syncPackages(){
    const { workspaceRoot } = this
    const packages = this.packages
    const tasks = logger.tasklist("同步本地与NPM的包发布信息：")  
    for(let package of packages){
        tasks.add(`同步[${package.name}]`)
        try{
            // 1. 从NPM上读取已发布的包信息
            let releaseInfo = await getPackageReleaseInfo.call(this,package)
            if(releaseInfo){
                let packageData = getPackageJson(path.join(workspaceRoot,"packages",dirName)) 
                packageData.lastPublish =  releaseInfo.lastPublish      
                if(packageData.version !=  releaseInfo.version ){
                    packageData.version =  releaseInfo.version    
                    // 更新本地文件
                    fs.writeJSONSync(path.join(package.fullPath,"package.json"),packageData,{spaces:4})
                }        
                tasks.complete(`${shortDate(package.lastPublish)}(v${packageData.version})`)          
            }else{
                tasks.skip("不存在")
            }            
        }catch(e){
            tasks.error(`${e.message}`)
        }
    }
}


program
    .description("同步本地与NPM的包信息")
    .action(async (options) => {
        const context = getWorkspaceContext(options)
        context.packages = await getPackages.call(context)
        await syncPackages.call(context)
    })

program.parse(process.argv);


