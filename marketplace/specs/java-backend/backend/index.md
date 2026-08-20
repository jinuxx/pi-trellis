# 后端开发规范

## 适用范围

本模板适用于 Java、Spring、Maven、MyBatis/MyBatis-Plus 类后端项目，覆盖分层、持久化、错误处理、日志和质量验证。

项目已有实现优先于本模板的泛化建议。新增规范必须以真实代码、配置或测试为依据；认证、外部集成、性能、前端和领域业务规则应放在项目自己的规范文件中。

## 开发前清单

开始后端修改前：

- [ ] 确认目标模块、包路径和相邻功能的实现方式。
- [ ] 阅读与改动范围对应的规范文件。
- [ ] 搜索已有的 Controller、Service、Mapper、Entity、DTO/VO、异常、响应、工具和测试。
- [ ] 判断改动是否同时影响 API、业务逻辑、数据库、配置或外部接口。
- [ ] 明确权限、数据范围、逻辑删除、事务和错误响应边界。

## 规范索引

| 规范 | 内容 | 状态 |
|---|---|---|
| [Directory Structure](./directory-structure.md) | 模块布局、分层职责和命名 | Filled |
| [Database Guidelines](./database-guidelines.md) | Entity、查询、事务、迁移和数据库安全 | Filled |
| [Error Handling](./error-handling.md) | 校验、异常、响应和外部失败 | Filled |
| [Logging Guidelines](./logging-guidelines.md) | 日志级别、内容、堆栈和脱敏 | Filled |
| [Quality Guidelines](./quality-guidelines.md) | 实现模式、测试和审查 | Filled |
| [Thinking Guides](../guides/index.md) | 代码复用和跨层改动检查 | Filled |

## 全局原则

- 依赖方向保持为 `Controller → Service → Mapper`；只有稳定且跨功能复用的能力才进入 common/base 层。
- Controller 保持薄层，不直接查库、不承载事务、不复制全局响应和异常转换。
- Service 负责业务校验、事务、权限/数据范围、跨 Mapper 协调和 DTO 映射。
- Mapper 只负责持久化查询；复杂 SQL 遵循项目约定放在对应 XML 或 Mapper 方法中。
- Request、Entity、DTO、VO 按职责分离；Entity 不直接作为公开 API 模型，除非项目已有明确约定。
- 修改前先复用现有实现；不要为了一个调用点创建新的平行抽象。
- 变更应保持最小范围，并同步维护受影响的代码、配置、迁移、文档和测试。

## 冲突处理

1. 安全、数据完整性和用户明确要求优先。
2. 项目已有且被多个调用方依赖的行为优先于泛化模板。
3. 更具体的模块规范优先于本文件。
4. 无法确认时先搜索调用方、配置和测试，不凭猜测改变公共契约。
