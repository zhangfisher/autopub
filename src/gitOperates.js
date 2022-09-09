/**
 * 
 * 操作Git的相关命令
 * 
 * 默认情况下，所有函数的this均指向context
 * 
 */

const { execShellScriptWithReturns,asyncExecShellScript } = require("./utils")
const shelljs = require("shelljs")
const path = require("path")

/**
 * 返回自relTime以来提交的次数
 * @param {*} package   {name,dirName,fullpath,}
 * @param {*} fromTime   标准时间格式
 * @returns 
 */
 async function getPackageNewCommits(package,fromTime){
    const { silent } = this
    const excludePackageJson = `":(exclude)${path.join(package.fullPath,'package.json')}"`
    const gitCmd = `git shortlog HEAD ${fromTime ? '--after={'+fromTime+'}': ''} -s -- ${package.fullPath} ${excludePackageJson}`
    let count = 0
    shelljs.cd(package.fullPath)
    try{
        let result = await asyncExecShellScript.call(this,gitCmd,{ silent })
        count = result.split("\n").map(v=>parseInt(v)).reduce((prev,cur)=>prev+cur,0)  || 0
    }catch(e){ }   
    return count
}
/**
 * 切换到指定的分支
 */
 async function checkoutBranch(name){
    try{
        const result = await asyncExecShellScript.this(`git checkout ${name}`,{silent:true})
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
    return  execShellScriptWithReturns.call(this,"git branch",{silent:true}).split("\n").filter(name=>name.trim().startsWith("*"))[0].replace("*","").trim()
}
 
/**
 * 恢复指定的文件到最近的版本
 */
function recoveryFileToLatest(file){
    return  execShellScriptWithReturns.call(this,`git checkout -- ${file}`)
}

function commitFiles(files=[],message){
    if(files.length==0) return
    return  execShellScriptWithReturns.call(this,`git commit ${files.join(" ")} -m '${message}'`)
}

function addGitTag(tag,message){
    return execShellScriptWithReturns.call(this,`git git -a ${tag} -m '{message}'`)

}

module.exports = {
    getPackageNewCommits,
    checkoutBranch,
    getCurrentBranch,
    recoveryFileToLatest,
    commitFiles,
    addGitTag
}