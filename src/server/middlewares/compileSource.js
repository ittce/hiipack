/**
 * @file
 * @author zdying
 */

'use strict';

var fs = require('fs');
var path = require('path');

var logger = log.namespace('Server');
var Compiler = require('../../compiler');

var imagePath = path.resolve(__dirname, '..', 'source', 'image');
var docSVG = fs.readFileSync(path.resolve(imagePath, 'Document.svg'));
var fileSVG = fs.readFileSync(path.resolve(imagePath, 'File.svg'));
var folderSVG = fs.readFileSync(path.resolve(imagePath, 'Folder.svg'));

var configWatchers = {};

module.exports = function(req, res, next){
    var url = req.url;
    // var filePath = path.resolve('.' + url);
    var filePath = __hii__.cwd + url;
    var projInfo = this.getProjectInfoFromURL(url);

    logger.debug('projInfo:' + JSON.stringify(projInfo));

    if(projInfo){
        var projectName = projInfo.projectName;
        var fileExt = projInfo.fileExt;
        var env = projInfo.env;
        var compiler = this.compilers[projectName];
        var configPath = path.join(__hii__.cwd, projectName, 'hii.config.js');

        // 第一次请求这个项目，新建一个compiler
        if(!compiler){
            compiler = this.compilers[projectName] = new Compiler(projectName);

            watchConfigFile(projectName, configPath, function(){
                // 删除原来的compiler，下次请求的时候，重新创建
                this.compilers[projectName] = false;
            }.bind(this));
        }

        if(fileExt === 'scss'){
            // 编译sass文件
            return compiler.compileSASS(filePath, function(err, css, time, result){
                if(err){
                    res.statusCode = 500;
                    res.end(err.stack || err.message)
                }else{
                    res.setHeader('Content-Type', 'text/css');
                    res.end(css);
                    logger.debug('*.sass', '-', filePath.bold, 'compiled', (time + 'ms').magenta);
                }
                logger.access(req);
            });
        }else if(fileExt === 'js'){
            if(env === 'prd' || req.url.indexOf('hot-update.js') !== -1){
                return compiler.compile('loc', function(){
                    this.sendCompiledFile(req, projInfo)
                }.bind(this))
            }else if(env === 'dev'){
                filePath = filePath.replace(/@(\w+)\.(\w+)/, '@dev.$2');

                logger.debug(req.url, '==>', filePath);

                if(fs.statSync(filePath).isFile()){
                    this.sendFile(req, filePath)
                }
            }else if(env === 'src' || env === 'loc'){
                this.sendFile(req)
            }
        }else if(fileExt === 'css'){
            if(env === 'src' && fs.existsSync(filePath)){
                this.sendFile(req, filePath);
            }else{
                return compiler.compile('loc', function(){
                    this.sendCompiledFile(req, projInfo)
                }.bind(this));
                // var userConfig = require(path.resolve(__hii__.cwd, projInfo.projectName, 'hii.config.js'));
                // var entry = userConfig.entry;
                // var entries = Object.keys(entry);
                //
                // if(entries.indexOf(projInfo.fileName) !== -1){
                //     // 处理css文件
                //     res.setHeader('Content-Type', 'text/css');
                //     logger.debug('css -', filePath.bold, 'replaced');
                //     res.end('/* The `css` code in development environment has been moved to the `js` file */');
                //     logger.access(req);
                // }else{
                //     // will return 404
                //     this.sendFile(req, filePath);
                // }
            }
        }else{
            // 其它文件
            filePath = filePath.replace(/\/prd\//, '/src/');

            logger.debug(req.url, '==>', filePath);
            try{
                if(fs.statSync(filePath).isFile()){
                    this.sendFile(req, filePath)
                }
            }catch(e){
                res.statusCode = 404;
                res.end('404 Not Found');
                logger.error(e);
                logger.access(req);
            }
        }
    }else{
        try{
            var stat = fs.statSync(filePath);
            if(stat.isDirectory()){
                fs.readdir(filePath, function(err, files){
                    if(err){
                        logger.error(err);
                    }else{
                        res.setHeader('Content-Type', 'text/html');

                        var html = [
                            '<header>',
                            '<meta charset="utf-8">',
                            '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">',
                            '</header>',
                            '<style>',
                            'ul{ padding: 0; font-family: monospace; font-size: 14px; }',
                            'li{ list-style: none; margin: 5px; width: 195px; display: inline-block; color: #0077DD; }',
                            'li:hover{ color: #FF5522; }',
                            'a { padding: 15px 5px; display: block; color: #0077DD; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
                            'a:hover { color: #FF5522 }',
                            'svg{ width: 36px; height: 36px; vertical-align: middle; margin: 0 10px 0 0; }',
                            '</style>',
                            '<ul>'
                        ];
                        html.push('<li>');
                        html.push(      '<a href="', url.replace(/\/([^\/]*?)\/?$/, '/') , '">', folderSVG, '../</a>');
                        html.push('</li>');
                        var filesItem = files.map(function(fileName){
                            if(fileName.slice(0, 1) === '.'){
                                logger.debug('hide system file/directory', fileName.bold);
                                // 不显示系统隐藏文件
                                return
                            }

                            var isFile = fs.statSync(filePath + '/' + fileName).isFile();

                            return [
                                '<li>',
                                '<a title="' + fileName + '" href="' + (isFile ? fileName : fileName + '/') + '">',
                                isFile ? (fileName.indexOf('.') === -1 ? fileSVG : docSVG) : folderSVG,
                                fileName,
                                '</a>',
                                '</li>'
                            ].join('')
                        });

                        html.push.apply(html, filesItem);
                        html.push('</ul>');
                    }

                    res.end(html.join(''));

                    logger.access(req);
                });
            }else{
                this.sendFile(req)
            }
        }catch(e){
            res.statusCode = 404;
            res.end('404 Not Found');

            logger.error(e);
            logger.access(req);
        }
    }
};

function watchConfigFile(projectName, configPath, cbk){
    if(configWatchers[projectName] !== true){
        // 记录一下已经watch的文件， 避免多次watch
        configWatchers[projectName] = true;

        log.debug('compileSource - watch config file', configPath.bold.green);

        fs.watchFile(configPath, {interval: 2000}, function(curr, prev){
            if(curr.mtime !== prev.mtime){
                // 清除require缓存
                delete require.cache[configPath];

                cbk && cbk(curr, prev);

                log.debug(
                    'compileSource - config file changed:', configPath.bold.green.bold
                );
            }
        }.bind(this))
    }
}