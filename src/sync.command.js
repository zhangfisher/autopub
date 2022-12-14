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
const logger = require("logsets"); 
const { getWorkspaceContext,getPackages } = require('./context')
const { getPackageReleaseInfo,getPackageJson,shortDate } = require('./utils')
 

/**
 * 
 * 根据包信息依赖关系进行对要发布的包进行排序
 * 
 */
 async function syncPackages(){
    const { workspaceRoot, log } = this
    const packages = this.packages
    const tasks = logger.tasklist("同步本地与NPM的包发布信息:")  
    for(let package of packages){
        tasks.add(`同步[${package.name}]`)
        try{
            // 1. 从NPM上读取已发布的包信息
            let lastReleaseInfo = await getPackageReleaseInfo.call(this,package)
            if(lastReleaseInfo){
                let packageData = getPackageJson(path.join(workspaceRoot,"packages",package.dirName)) 
                packageData.lastPublish =  lastReleaseInfo.lastPublish      
                if(packageData.version !=  lastReleaseInfo.version ){
                    packageData.version =  lastReleaseInfo.version
                    let i = packageData.version.indexOf("-")
                    if(i > -1) packageData.version = packageData.version.substring(0,i)
                    // 更新本地文件
                    fs.writeJSONSync(path.join(package.fullPath,"package.json"),packageData,{spaces:4})
                }        
                tasks.complete(`${shortDate(package.lastPublish)}(v${lastReleaseInfo.version})`)          
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
        try{
            context.packages = await getPackages.call(context)
            await syncPackages.call(context)
        }catch(e){
            context.log(e.stack)
        }finally{
            await context.end()
        }
    })

program.parse(process.argv);


