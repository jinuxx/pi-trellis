# 后端目录结构

## 适用范围

新增模块、类、接口、Mapper XML、配置或测试时使用本规范。先沿用目标模块相邻功能的布局，不要因为模板中的示例而搬动既有代码。

## 分层职责

典型调用链：

```text
Controller → Service → Repository（必要时）→ Mapper → Database
```

- **Controller**：声明路由和 API 文档，绑定请求参数，执行结构性输入校验和权限注解，调用 Service 并返回项目统一响应。
- **Service**：拥有业务流程、事务边界、资源存在性校验、权限/数据范围校验和跨持久化操作。
- **Repository**：仅在多个 Mapper 操作需要组合，或持久化需要 Redis/外部协调时使用；简单 CRUD 不额外增加 Repository。
- **Mapper**：Java 接口只声明方法和参数；标准 CRUD 可复用基类，所有自定义 SQL 写在对应 Mapper XML，不承载业务规则。
- **Entity/PO**：映射数据库记录；持久化字段、逻辑删除字段和审计字段遵循项目已有基类与注解。
- **Request/DTO/VO**：分别表达外部输入、跨层传输和 API 输出；不要把数据库字段和公开响应契约混为一体。
- **Common/Base**：只放稳定、跨模块复用的异常、响应、基础实体、工具和基础设施。

## 新功能放置规则

- 先确认代码属于哪个 Maven/module，再确认目标 feature/package。
- 按现有项目选择“按业务模块分包”或“按技术层分包”，不要引入第三种组织方式。
- 一个类不需要的空层不要创建；只有实际存在职责时才建立 `repository`、`job`、`dto` 或 `vo`。
- Mapper XML 必须放在对应 `Mapper.java` 同目录下的 `xml/` 子目录，例如 `mapper/UserMapper.java` 对应 `mapper/xml/UserMapper.xml`；同时确认 `pom.xml` 资源配置和 `mapper-locations` 能加载它。
- 测试放在对应模块的测试目录，保持包路径与被测代码一致。

## 命名与风格

- Java 类使用项目既有的 PascalCase 和后缀约定；字段使用 camelCase。
- 数据库表和列沿用现有命名，新增名称使用项目统一的 snake_case 规则。
- Controller 路径、响应类型、异常类型和注解风格保持与相邻接口一致。
- 使用构造注入和项目已有 Lombok/Logger 约定，不引入平行风格。

## 禁止做法

- 在 Controller 中直接写 SQL、编排跨表事务或复制业务判断。
- 为单个业务类新建一个通用工具，未先搜索 common/base 和现有 feature 工具。
- 为无关功能移动、重命名 legacy package 或重排模块结构。
- 在未检查模块 `pom.xml`、组件扫描和资源配置前新增 Mapper XML。
- 把 Entity 直接暴露为公开 API，或让 VO/DTO 反向承担数据库写入职责。

## 验证清单

- [ ] 新文件位于正确 module 和 feature/package。
- [ ] 分层调用方向没有反向依赖。
- [ ] Mapper XML 能被构建和运行时加载。
- [ ] Request、Entity、DTO/VO 的职责没有混用。
- [ ] 测试覆盖了新增的边界或公共契约。
