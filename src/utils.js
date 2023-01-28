const shelljs = require("shelljs");
const path = require("path")
const semver = require('semver')
const fs = require("fs-extra")
const dayjs = require("dayjs");
const glob = require("fast-glob")
const relativeTimeExtend = require("dayjs/plugin/relativeTime");
dayjs.extend(relativeTimeExtend);
require('dayjs/locale/zh-CN')
dayjs.locale("zh-CN");


// 工作区标志文件，存在即代表是工作区根目录
const monoRepoRootFlags = ["pnpm-workspace.yaml"]

/**
 * 检测当前工程是否是git工程
 */
function isGitRepo(){
    return shelljs.exec("git status", {silent: true}).code === 0;
}

/**
 * 以指定的文件夹为基准向上查找文件package.json，并返回package.json所在的文件夹
 * @param {*} folder           起始文件夹，如果没有指定，则取当前文件夹
 * @param {*} excludeCurrent   如果=true，则从folder的父文件夹开始查找
 * @returns 
 */
 function getPackageRootFolder(folder="./",excludeCurrent=false){
    if(!folder) folder = process.cwd();
    if(!path.isAbsolute(folder)){
        folder = path.join(process.cwd(),folder)
    }
    try{ 
        const pkgFile =excludeCurrent ?  path.join(folder, "..", "package.json") : path.join(folder, "package.json")
        if(fs.existsSync(pkgFile)){ 
            return path.dirname(pkgFile)
        }
        const parent = path.dirname(folder)
        if(parent===folder) return null
        return getPackageRootFolder(parent,false)
    }catch(e){
        return process.cwd()
    }
}
/**
 * 以指定的文件夹为基准向上查找文件工作区标志文件(如pnpm-workspace.yaml)，并返回工作区根文件夹
 * @param {*} folder           起始文件夹，如果没有指定，则取当前文件夹
 * @returns 
 */
function getWorkspaceRootFolder(folder="./"){
    if(!folder) folder = process.cwd();
    if(!path.isAbsolute(folder)){
        folder = path.join(process.cwd(),folder)
    }
    try{ 
        const wfFiles =monoRepoRootFlags.map(filename=>path.join(folder,filename))
        if(wfFiles.some(file=>fs.existsSync(file))){
            return path.dirname(wfFiles[0])
        }
        const parent = path.dirname(folder)
        if(parent===folder) return null
        return getWorkspaceRootFolder(parent,false)
    }catch(e){
        return null
    }
}
/**
 * 获取当前工程的package.json文件内容
 * 读取指定文件夹的package.json文件，如果当前文件夹没有package.json文件，则向上查找
 * @param {*} folder 
 * @param {*} excludeCurrent    = true 排除folder，从folder的父级开始查找
 * @returns 
 */
 function getPackageJson(folder,excludeCurrent=false){ 
    if(!folder) folder = process.cwd();
    if(!path.isAbsolute(folder)){
        folder = path.join(process.cwd(),folder)
    }
    let projectFolder = getPackageRootFolder(folder,excludeCurrent)
    if(projectFolder){
       return fs.readJSONSync(path.join(projectFolder,"package.json"))
    }
}
/**
 * 判断当前是否在工作区根目录
 */
function isWorkspaceRoot(folder){ 
    return monoRepoRootFlags.some(file=>fs.existsSync(path.join(folder,file)))
}

/**
 * 发现当前工作区下的包文件夹列表
 * 
 * 即包括package.json的文件夹列表
 * 该方法会遍历pacakges下的第二层文件夹来读取包列表
 * 
 * ["apps/vueapp","utils","runtime","vue","react"]
 * 
 * @Returns {Array} ["<相对packages的路径>",....]
 */
function findPackageDirs(){
    const { excludes,workspaceRoot,includeDescendants = false} = this
    const packagesPath = replaceAll(path.normalize(path.join(workspaceRoot,"packages")),path.sep,"/")
    let pkgFiles = glob.sync([
        includeDescendants ? packagesPath+"/**/package.json":packagesPath+"/*/package.json", 
        "!**/node_modules"
    ])
    let packageDirs = pkgFiles.map(file=>path.dirname(file))
                        .map(fullPath=>path.relative(packagesPath,fullPath))  // 转换为相对路径
                        .filter(relDir=>!excludes.includes(relDir))
    return packageDirs
}

/**
 * 断言当前是否在工作区根目录
 */
function assertInWorkspaceRoot(){
    if(!isWorkspaceRoot(process.cwd())){
        throw new Error("命令只能在工作区根目录下执行")
    }
}

function isPackageRoot(folder){
    const currentFolder = process.cwd()
    return fs.existsSync(path.join(currentFolder,"package.json"))
}

/**
 * 返回当前工作区下的所有包名称
 * @param {*} rootFolder 
 */
function readPackages(rootFolder){
    return fs.readdirSync(path.join(workspaceRoot,"packages"))
}

/**
 * 判断当前是否在包下面的项目目录
 * 
 * 即packages/xxxx
 * 
 */
function assertInPackageRoot(){
   const currentFolder = process.cwd()
   const workspaceRoot = path.join(currentFolder,"../../")
   if(!isPackageRoot(currentFolder)){ 
       throw new Error("命令只能在包目录下执行")
   }
}
 
 /**
  * 执行脚本，出错会返回错误信息
  * @param {*} script 
  */
function execShellScript(script,options={}){
    let {log,code,stdout} = shelljs.exec(script,options)
    log(`Run Script: ${script}`)
    if(code>0){
        const result = `执行<${script}>失败: ${stdout.trim()}`
        log(result)
        new Error(result)
    }
}
/**
 * 异步执行脚本
 * @param {*} script 
 * @param {*} options 
 * @returns 
 */
async function asyncExecShellScript(script,options={}){
    const { silent=true,log} = this
    log(`Run Script: ${script}`)
    return new Promise((resolve,reject)=>{
        shelljs.exec(script,{silent,...options,async:true},(code,stdout)=>{
            if(code>0){
                const info = `执行<${script}>失败: ${stdout.trim()}`
                log(info)
                console.error(info)
                reject(new Error(info))
            }else{
                resolve(stdout.trim())
            }
        })   
    }) 
}
 /**
  * 执行脚本并返回结果
  * @param {*} script 
  */
function execShellScriptWithReturns(script,options={}){
    let { silent,log } = this
    const result = shelljs.exec(script,{silent,...options}).stdout.trim()
    log(`执行<${script}>：${result}`)
    return result
}

/** 
 * 
 * 通过遍历所有文件夹来获取指定包最近一次修改的时间
 * 
 * 读取文件的修改时间并取最近的时间
 * 
 * @param {*} entryFolder 
 * @returns 
 */
 function getFolderLastModified(entryFolder,patterns=[],options={}){   
    // 排除的文件夹 
    patterns.push(...[
        "package.json",
        "**",
        "**/*",
        "!node_modules/**",
        "!node_modules/**/*",
        "!**/node_modules/**",
        "!**/node_modules/**/*",
    ])
    const glob = require("fast-glob")
    let files = glob.sync(patterns, {
        cwd: entryFolder,
        absolute:true,
        ...options
    }) 
    let lastUpdateTime = null
    for(let file of files){
        const { mtimeMs } = fs.statSync(file)
        lastUpdateTime = lastUpdateTime ? Math.max(lastUpdateTime,mtimeMs) : mtimeMs
    }
    return lastUpdateTime 
} 

/**
 * 获取文件修改时间
 * @param {*} file 
 * @returns 
 */
function getFileLastModified(file){
    return fs.statSync(file).mtimeMs
}

function shortDate(time,format ="MM/DD hh:mm:ss" ){
    return dayjs(time).format(format) 
}

function longDate(time,format ="YYYY/MM/DD" ){
    return dayjs(time).format(format) 
}

function relativeTime(time){
    return dayjs(time).fromNow()
}
function isAfterTime(time,baseTime){
    return dayjs(time).isAfter(dayjs(baseTime)) 
}
function isSameTime(time,baseTime){
    return dayjs(time).isSame(dayjs(baseTime))
} 
  

/**
 * 从NPM获取包最近发布的版本信息
 * @param {*} package  {name,dirName,fullpath,}
 */
async function getPackageReleaseInfo(package) {
    const { silent,test,log } = this
    try{
        let results = await asyncExecShellScript.call(this,`npm info ${package.name} --json`,{silent})
        const info = JSON.parse(results)
        const distTags = info["dist-tags"]
        // 取得最新版本的版本号，不是latest
        let lastVersion = Object.entries(distTags).reduce((result,[tag,value])=>{
            if(semver.gt(value, result.value)){
                result = {tag,value}
            }
            return result
        },{tag:'latest',value:info["version"]})

        return {
            tags         : distTags, 
            license      : info["license"], 
            author       : info["author"],
            version      : `${lastVersion.value}-${lastVersion.tag}`,
            latestVersion: info["version"],
            firstCreated : info.time["created"],
            lastPublish  : info.time["modified"],
            size         : info.dist["unpackedSize"] 
        }
    }catch(e){
        log(`ERROR: 执行npm info ${package.name}出错: ${e.stack}`)
        return null;        
    }    
}

/**
 * 
 * 判断自relTime时间项目是否已经有改变
 * 
 * 判断提交次数，如果大于0说明有改变
 * 
 * @param {*} package  {name,dirName,fullpath,modifiedTime} 
 */
async function packageIsDirty(package){ 
    return await getPackageNewCommits.call(this,package,package.lastPublish) > 0
}

function isEmpty(value){
    if(value==undefined) return true
    if(typeof(value)=="string" && value.trim()=='') return true
    return false    
}

/**
 * 替换所有字符串
 * 低版本ES未提供replaceAll,此函数用来替代
 * @param {*} str 
 * @param {*} findValue 
 * @param {*} replaceValue 
 */
 function replaceAll(str,findValue,replaceValue){    
    if(typeof(str)!=="string" || findValue=="" || findValue==replaceValue) return str
    try{
        return str.replace(new RegExp(escapeRegexpStr(findValue),"g"),replaceValue)
    }catch{}
    return str
}

function escapeRegexpStr(str){
    return str.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1")
} 

function removeArrayItem(arr,item){
    let index 
    while((index = arr.indexOf(item))!=-1){
        arr.splice(index,1)
    }
    return arr
}

module.exports ={
    assertInWorkspaceRoot,
    assertInPackageRoot,           
    isGitRepo,
    isWorkspaceRoot,
    isPackageRoot,  
    isEmpty,
    getPackageJson,
    getPackageRootFolder,
    getWorkspaceRootFolder,
    execShellScript,
    asyncExecShellScript,
    execShellScriptWithReturns,
    getFolderLastModified,
    getFileLastModified,
    shortDate,
    longDate,
    relativeTime,
    isAfterTime,
    isSameTime,
    getPackageReleaseInfo,
    findPackageDirs,
    packageIsDirty,
    removeArrayItem
}