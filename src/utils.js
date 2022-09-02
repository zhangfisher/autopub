const shelljs = require("shelljs");
const path = require("path")
const fs = require("fs-extra")
const dayjs = require("dayjs");
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
    let {code,stdout} = shelljs.exec(script,options)
    if(code>0){
        new Error(`执行<${script}>失败: ${stdout.trim()}`)
    }
}
/**
 * 异步执行脚本
 * @param {*} script 
 * @param {*} options 
 * @returns 
 */
async function asyncExecShellScript(script,options={}){
    const { silent=true} = this
    return new Promise((resolve,reject)=>{
        shelljs.exec(script,{silent,...options,async:true},(code,stdout)=>{
            if(code>0){
                reject(new Error(`执行<${script}>失败: ${stdout.trim()}`))
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
    return shelljs.exec(script,options).stdout.trim()
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
 * @param {*} package  {name,folderName,fullpath,}
 */
async function getPackageReleaseInfo(package) {
    const { silent,test } = this
    try{
        let results = await asyncExecShellScript(`npm info ${package.name} --json`,{silent})
        const info = JSON.parse(results)
        return {
            tags        : info["dist-tags"], 
            license     : info["license"], 
            author      : info["author"],
            firstCreated: info.time["created"],
            lastPublish : info.time["modified"],
            size        : info.dist["unpackedSize"] 
        }
    }catch(e){
        return null;        
    }    
}

/**
 * 
 * 判断自relTime时间项目是否已经有改变
 * 
 * 判断提交次数，如果大于0说明有改变
 * 
 * @param {*} package  {name,folderName,fullpath,modifiedTime} 
 */
async function packageIsDirty(package){ 
    return await getPackageCommitCount.call(this,package,package.lastPublish) > 0
}

/**
 * 返回自relTime以来提交的次数
 * @param {*} package   {name,folderName,fullpath,}
 * @param {*} relTime 标准时间格式
 * @returns 
 */
async function getPackageCommitCount(package,relTime){
    const { silent } = this
    const gitCmd = `git shortlog HEAD ${relTime ? '--after={'+relTime+'}': ''} -s -- packages/${package.folderName}`
    let count = 0
    shelljs.cd(package.fullPath)
    try{
        let result = await asyncExecShellScript(gitCmd,{ silent })
        count = result.split("\n").map(v=>parseInt(v)).reduce((prev,cur)=>prev+cur,0)  || 0
    }catch(e){ }   
    package.newCommits = count 
    return count
}
/**
 * 切换到指定的分支
 */
 async function checkoutBranch(name){
    try{
        const result = await asyncExecShellScript(`git checkout ${name}`,{silent:true})
        const current = getCurrentBranch()
        if(current!=name) throw new Error(`切换到${name}分支失败`)
    }catch(e){
        throw new Error(`切换到<${name}>分支失败`)
    }    
}

/**
 * 获取当前分支名称
 * @returns 
 */
function getCurrentBranch(){
    return  execShellScriptWithReturns("git branch",{silent:true}).split("\n").filter(name=>name.trim().startsWith("*"))[0].replace("*","").trim()
}

module.exports ={
    assertInWorkspaceRoot,
    assertInPackageRoot,           
    isGitRepo,
    isWorkspaceRoot,
    isPackageRoot,  
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
    getPackageCommitCount,
    packageIsDirty,
    checkoutBranch,
    getCurrentBranch
}