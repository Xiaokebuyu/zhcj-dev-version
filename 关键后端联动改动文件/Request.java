package top.mole9630.ada.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Data;
import java.util.Date;
import java.io.Serializable;
import com.fasterxml.jackson.annotation.JsonProperty;

@Data
@ApiModel("需求记录实体")
public class Request implements Serializable {
    private static final long serialVersionUID = 1L;
    
    @TableId(type = IdType.AUTO)
    @ApiModelProperty("需求编号")
    private Integer rId;

    @ApiModelProperty("残障人士id")
    private Integer rHid;

    @ApiModelProperty("志愿者id")
    private Integer rVid;

    @ApiModelProperty("发布时间")
    private Date rSendTime;

    @ApiModelProperty("积分")
    private Integer rScore;

    @ApiModelProperty("需求类型")
    @com.fasterxml.jackson.annotation.JsonProperty("rType")
    @TableField("r_type")     // 显式指定数据库字段名
    private Integer rType;

    @ApiModelProperty("是否解决")
    private Integer rIsSolve;

    @ApiModelProperty("需求内容")
    @com.fasterxml.jackson.annotation.JsonProperty("rContent")
    @TableField("r_content")  // 显式指定数据库字段名
    private String rContent;

    @ApiModelProperty("紧急程度")
    @JsonProperty("rUrgent")
    @TableField("r_urgent")   // 显式指定数据库字段名
    private Integer rUrgent;

    @ApiModelProperty("评分")
    private Integer rRate;

    @ApiModelProperty("解决时间")
    private Date rSolveTime;

    @ApiModelProperty("地址")
    @com.fasterxml.jackson.annotation.JsonProperty("rAddress")
    @TableField("r_address")  // 显式指定数据库字段名
    private String rAddress;

    @ApiModelProperty("线上/线下")
    @JsonProperty("rIsOnline")
    private Integer rIsOnline;
}