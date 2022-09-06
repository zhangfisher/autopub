/**
    
    获取当前工作区的上下文信息



 */
const fs = require("fs-extra");
const path = require("path");
const { 
    isEmpty,
    findPackageDirs,
    getPackageJson, 
    getPackageReleaseInfo,
    getWorkspaceRootFolder,
    getPackageNewCommits
} = require("./utils"); 


/**
 * 获取指定包信息
 */
async function getPackage(packageDirName){
    const {excludes,workspaceRoot,workspace,test,log} = this     

    // 1. 获取包package.json数据
    const packageFullPath = path.join(workspaceRoot,"packages",packageDirName)
    const pkgFile       = path.join(packageFullPath,"package.json")
    if(!fs.existsSync(pkgFile)) return 
    const packageInfo = getPackageJson(pkgFile)
    if(!packageInfo || (typeof(packageInfo)=='object' && !packageInfo.name )) return

    // 2. 读取当前包对工作区其他包的依赖列表,依赖是以"workspace:xxxx"的形式存在的
    const { name, scripts,version,description,dependencies={},devDependencies={},peerDependencies={},optionalDependencies={} } = packageInfo
    let packageDependencies =[]
    // 如果包存在对工作区其他包的引用,则需要记录起来
    // 特别需要注意的是：依赖写的一般是包名，但是有时包名与包文件夹名称有可能不一定相同
    const allDependencies = {...dependencies,...devDependencies,...peerDependencies,...optionalDependencies}
    Object.entries(allDependencies).forEach(([name,version])=>{
        if(version.startsWith("workspace:") && !excludes.includes(name.replace(`@${workspace.name}/`,""))){
            packageDependencies.push(name)
        }
    })
    let package = {
        name,                                               // 完整包名，即package.json中的name,一般比如@voerkai18n/utils之类的
        description,                                        // 包描述            
        version,                                            // 当前版本号
        scripts,                                            // 包脚本
        dirName     : packageDirName,                       // 文件夹名称，其可能与包名不一样
        lastPublish : packageInfo.lastPublish,              // 包最近一次发布的时间
        fullPath    : packageFullPath,                      // 完整路径
        dependencies: packageDependencies                   // 依赖的工作区包
    }

    // 4. 读取包最近一次发布的时间： 保存在每一个包package.json的lastPublish字段
    // 当lastPublish值为空时：
    //  1. 代表了可能从来没有发布
    //  2. 曾经发布但是lasPublish没有更新，一般是旧项目已经发布，但不是使用autopub
    //  则需要自动调用npm info <包名>来读取最近一次的发布信息并更新lastPublish
    if(isEmpty(package.lastPublish)){
        try{
            let info = await getPackageReleaseInfo.call(this,package)
            package.lastPublish = info.lastPublish
            fs.writeJSONSync(pkgFile,packageInfo,{spaces:4}) // 保存起来，以免下次再重复调用
        }catch(e){
            log(`从NPM获取包<${package.name}>发布信息时出错：${e.stack}`)
        }        
    }

    // 3. 读取包至上次发布以来的GIT提交信息
    try{
        package.newCommits  =  await getPackageNewCommits.call(this,package,package.lastPublish) 
        // 为什么要-1? 因为当发布成功后，会自动进行一次提交，提交修改的package.json等分布过程中产生的数据，这次提交不算
        if(package.newCommits >0 ) package.newCommits = package.newCommits -1
        package.totalCommits =  await getPackageNewCommits.call(this,package)      
        package.isDirty =   package.newCommits  > 0 
    }catch(e){
        log(`读取包<${package.name}>的提交次数时出错：${e.stack}`)
    }    

    return package
}
/**
 * 获取当前工作区所有包信息
 * 注意：this -> workspaceContext
 * @returns [{}]
 */
 async function getPackages(){     
    const { excludes,workspaceRoot,workspace,log } = this
    
    // 1.读取所有包信息
    const packageDirs = findPackageDirs.call(this)
    let packages = []
    for(let packageDirName of packageDirs){
        if(excludes.includes(packageDirName)) continue
        try{
            const pkgInfo = await getPackage.call(this,packageDirName)
            if(pkgInfo && !excludes.includes(pkgInfo.name)) {
                packages.push(pkgInfo)                
            }
        }catch(e){
            log(`读取包<${packageDirName}>信息时出错: ${e.stack}`)
        }
    } 
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
    // 3. 当存在依赖关系时: 如果A依赖B，当A.isDirty=true,则B.isDirty也为true
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
 * 当完成命令行时执行，用来进行一些
 */
function quit(context){

}

/**
 * 读取当前工作区和包信息，该信息将作为this传递给所有相关函数，以便可以获取到共享信息
 * @param {*} options          // 命令行参数
 */
 function getWorkspaceContext(options) {
    // 1. 获取当前工作区根路径
    const workspaceRoot =  getWorkspaceRootFolder()
    if(!workspaceRoot) {
        logger.log("命令只能在PNPM工作区内执行")
        process.exit(0)
    }
    const workspaceInfo = getPackageJson(workspaceRoot)
    // 2. 生成默认的工作区相关信息
    const context = {
        workspaceRoot,                               // 工作区根路径
        excludes           : [],                      // 要排除发布的包名称，如果包含@代表是包名，也可以写文件夹名称
        lastPublish        : null,                    // 最后发布的时间
        buildScript        : "build",                 // 发布前执行构建的脚本
        releaseScript      : "release",               // 发布命令,当发布所有包时会调用
        report             : "versions.md",           // 发布报告信息,支持md和json两种格式
        changeLogs         : "changeLogs",            // 发布变更日志
        versionIncStep     : "patch",                 // 默认版本增长方式
        silent             : true,                    // 静默发布，不提示信息
        workspace          : workspaceInfo,           // 工作区package.json
        includeDescendants : false,                   //  是否查找位于packaces下包括代代文件夹中的所有的包
        distTag            : null,                    // 发布标签 
        test               : false,                   // 模拟发布   
        releaseBranch      : null,                    // 发布分支，未指定时采用当前分支
        force              : false,                   // 强制发布包
        pnpmPublishOptions : {},                      // 用来传递给pnpm publish的额外参数
        packages           : null,                    // 要发布的所有包packages包信息
        logs               : [],                      // 发包日志，后续会保存到autopub.log
        ...workspaceInfo.autopub || {},          // 配置参数
        ...options
    }      
    context.log =   (function(info){this.logs.push(info)}).bind(context)
    context.end = quit.bind(context)
    return context
}

module.exports ={
    getWorkspaceContext,
    getPackages
}